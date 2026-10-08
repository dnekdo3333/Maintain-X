import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';

/// Default API address: the PC running `npm run dev` on the same Wi-Fi.
/// Change it on the sign-in screen (e.g. to the Vercel URL).
const kDefaultServer = 'http://172.16.57.188:4000';

/// Signed-in user and what they may do (mirrors the web AuthContext).
class Session extends ChangeNotifier {
  Session(this.api) {
    api.onSessionExpired = () {
      _user = null;
      notifyListeners();
    };
  }

  final ApiClient api;
  Json? _user;
  bool restoring = true;

  Json? get user => _user;
  bool get signedIn => _user != null;
  String get firstName => (_user?['firstName'] ?? '').toString();
  String get fullName => '${_user?['firstName'] ?? ''} ${_user?['lastName'] ?? ''}'.trim();
  String get roleName {
    final roles = (_user?['roles'] as List?) ?? const [];
    return roles.isEmpty ? '' : (roles.first as Map)['name'].toString();
  }

  bool get isSuperAdmin => _user?['isSuperAdmin'] == true;

  /// Admin shell for admin-kind roles; the worker app for everyone else.
  bool get isAdmin => _user?['roleKind'] == 'ADMIN';

  Set<String> get _perms => {for (final p in (_user?['permissions'] as List? ?? const [])) p.toString()};
  bool can(String permission) => isSuperAdmin || _perms.contains(permission);

  List<Json> get restaurants =>
      [for (final r in (_user?['restaurants'] as List? ?? const [])) (r as Map).cast<String, dynamic>()];

  Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();
    api.server = prefs.getString('server') ?? kDefaultServer;
    try {
      final s = await api.refresh();
      _user = s?['user'] as Json?;
    } catch (_) {
      _user = null;
    }
    restoring = false;
    notifyListeners();
  }

  Future<void> setServer(String url) async {
    api.server = url;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('server', api.server);
    notifyListeners();
  }

  Future<void> login(String identifier, String password) async {
    final s = await api.login(identifier.trim(), password);
    _user = s['user'] as Json;
    notifyListeners();
  }

  /// Re-reads the user (e.g. after adding a restaurant, so it shows in every picker).
  Future<void> reloadUser() async {
    try {
      final s = await api.refresh();
      if (s != null) {
        _user = s['user'] as Json;
        notifyListeners();
      }
    } catch (_) {
      // Keep the current user; the next sign-in picks the change up.
    }
  }

  void adopt(Json session) {
    api.accessToken = session['accessToken'] as String?;
    _user = session['user'] as Json;
    notifyListeners();
  }

  Future<void> logout() async {
    await api.logout();
    _user = null;
    notifyListeners();
  }
}
