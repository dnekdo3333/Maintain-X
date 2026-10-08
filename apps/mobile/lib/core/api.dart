import 'dart:io';
import 'dart:math';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import 'package:path_provider/path_provider.dart';

/// JSON object from the API.
typedef Json = Map<String, dynamic>;

/// A failed API call with the server's error code and message.
class ApiException implements Exception {
  ApiException(this.status, this.code, this.message, [this.fieldErrors]);
  final int status;
  final String code;
  final String message;
  final Map<String, dynamic>? fieldErrors;

  /// First field error, if any (more useful than the generic message).
  String get display {
    final fe = fieldErrors;
    if (fe != null && fe.isNotEmpty) {
      final first = fe.entries.first;
      final v = first.value;
      final msg = v is List && v.isNotEmpty ? v.first.toString() : v.toString();
      return '${first.key}: $msg';
    }
    return message;
  }

  @override
  String toString() => display;
}

/// Talks to the Express API (`/api/v1`). Same contract as the web app:
/// access token in memory, refresh token in an http-only cookie, CSRF header
/// on every call and an idempotency key on every write.
class ApiClient {
  ApiClient._(this._dio, this._jar);

  final Dio _dio;
  final CookieJar _jar;
  String? _accessToken;
  String _server = '';

  /// Called when the session can't be refreshed any more.
  void Function()? onSessionExpired;

  /// Cookies are kept on disk so the session survives app restarts.
  static Future<ApiClient> create() async {
    final dir = await getApplicationSupportDirectory();
    return withJar(PersistCookieJar(storage: FileStorage('${dir.path}/cookies')));
  }

  /// Same client with a given cookie jar (tests use an in-memory one).
  static ApiClient withJar(CookieJar jar) {
    final dio = Dio(BaseOptions(
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 60),
      sendTimeout: const Duration(seconds: 120),
      headers: {'x-requested-with': 'maintainx', 'Accept': 'application/json'},
      // Errors are read from the body below.
      validateStatus: (_) => true,
    ));
    dio.interceptors.add(CookieManager(jar));
    return ApiClient._(dio, jar);
  }

  String get server => _server;

  set server(String value) {
    _server = value.trim().replaceAll(RegExp(r'/+$'), '');
    _dio.options.baseUrl = '$_server/api/v1';
  }

  set accessToken(String? token) => _accessToken = token;

  /// Absolute URL for a file link the API returns (`/api/v1/files?...`).
  String fileUrl(String? path) {
    if (path == null || path.isEmpty) return '';
    if (path.startsWith('http')) return path;
    return '$_server$path';
  }

  Future<void> clearCookies() => _jar.deleteAll();

  static final _rand = Random.secure();
  static String _key() =>
      List.generate(24, (_) => _rand.nextInt(36).toRadixString(36)).join();

  Future<dynamic> _send(
    String method,
    String path, {
    Object? body,
    Map<String, dynamic>? query,
    bool anonymous = false,
    bool retry = true,
  }) async {
    final headers = <String, dynamic>{};
    if (!anonymous && _accessToken != null) headers['Authorization'] = 'Bearer $_accessToken';
    if (method != 'GET' && !anonymous) headers['Idempotency-Key'] = _key();
    final cleanQuery = query == null
        ? null
        : {
            for (final e in query.entries)
              if (e.value != null && e.value.toString().isNotEmpty) e.key: e.value
          };
    Response<dynamic> res;
    try {
      res = await _dio.request<dynamic>(
        path,
        data: body,
        queryParameters: cleanQuery,
        options: Options(method: method, headers: headers),
      );
    } on DioException catch (e) {
      if (e.error is SocketException || e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.connectionError) {
        throw ApiException(0, 'NETWORK_ERROR',
            'Server se connect nahi ho paya. Internet / server address check karein.');
      }
      throw ApiException(0, 'NETWORK_ERROR', e.message ?? 'Network error');
    }

    final status = res.statusCode ?? 0;
    final data = res.data;
    if (status >= 200 && status < 300) return data;

    final err = data is Map ? data['error'] as Map? : null;
    final code = (err?['code'] ?? 'INTERNAL_ERROR').toString();
    if (status == 401 &&
        retry &&
        !anonymous &&
        _accessToken != null &&
        (code == 'TOKEN_EXPIRED' || code == 'TOKEN_INVALID')) {
      if (await refresh() != null) {
        return _send(method, path, body: body, query: query, anonymous: anonymous, retry: false);
      }
      onSessionExpired?.call();
    }
    throw ApiException(
      status,
      code,
      (err?['message'] ?? 'Request failed ($status)').toString(),
      (err?['fieldErrors'] as Map?)?.cast<String, dynamic>(),
    );
  }

  Future<dynamic> get(String path, [Map<String, dynamic>? query]) =>
      _send('GET', path, query: query);
  Future<dynamic> post(String path, [Object? body]) => _send('POST', path, body: body ?? {});
  Future<dynamic> put(String path, [Object? body]) => _send('PUT', path, body: body ?? {});
  Future<dynamic> patch(String path, [Object? body]) => _send('PATCH', path, body: body ?? {});
  Future<dynamic> delete(String path) => _send('DELETE', path);

  /// `data` of an `{ data: ... }` response.
  Future<T> getData<T>(String path, [Map<String, dynamic>? query]) async =>
      (await get(path, query) as Map)['data'] as T;
  Future<T> postData<T>(String path, [Object? body]) async =>
      (await post(path, body) as Map)['data'] as T;
  Future<T> putData<T>(String path, [Object? body]) async =>
      (await put(path, body) as Map)['data'] as T;

  Future<Json> login(String identifier, String password) async {
    final res = await _send('POST', '/auth/login',
        body: {'identifier': identifier, 'password': password}, anonymous: true);
    final session = (res as Map)['data'] as Json;
    _accessToken = session['accessToken'] as String;
    return session;
  }

  /// New access token from the refresh cookie; null when signed out.
  Future<Json?> refresh() async {
    try {
      final res = await _send('POST', '/auth/refresh', anonymous: true, retry: false);
      final session = (res as Map)['data'] as Json;
      _accessToken = session['accessToken'] as String;
      return session;
    } on ApiException catch (e) {
      if (e.status == 401 || e.status == 403) {
        _accessToken = null;
        return null;
      }
      rethrow;
    }
  }

  Future<void> logout() async {
    try {
      await _send('POST', '/auth/logout', anonymous: true, retry: false);
    } catch (_) {
      // Signing out locally must always work.
    }
    _accessToken = null;
    await clearCookies();
  }

  /// Uploads one document as multipart `file` with its form fields (POST /documents).
  Future<Json> uploadDocument(File file, Map<String, String> fields) async {
    final form = FormData();
    fields.forEach((k, v) => form.fields.add(MapEntry(k, v)));
    final name = file.path.split(Platform.pathSeparator).last;
    form.files.add(MapEntry('file', await MultipartFile.fromFile(file.path, filename: name)));
    final res = await _send('POST', '/documents', body: form);
    return (res as Map)['data'] as Json;
  }

  /// Uploads photos as multipart `files` (plus extra fields first).
  Future<Json> upload(String path, List<File> files, [Map<String, String> fields = const {}]) async {
    final form = FormData();
    fields.forEach((k, v) => form.fields.add(MapEntry(k, v)));
    for (final f in files) {
      final name = f.path.split(Platform.pathSeparator).last;
      form.files.add(MapEntry('files', await MultipartFile.fromFile(f.path, filename: name)));
    }
    final res = await _send('POST', path, body: form);
    return (res as Map)['data'] as Json;
  }
}
