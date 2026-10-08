import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'core/api.dart';
import 'core/session.dart';
import 'core/theme.dart';
import 'screens/admin/admin_shell.dart';
import 'screens/login_screen.dart';
import 'screens/worker/worker_shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final api = await ApiClient.create();
  final session = Session(api);
  runApp(ChangeNotifierProvider.value(value: session, child: const BookendsApp()));
  await session.restore();
}

class BookendsApp extends StatelessWidget {
  const BookendsApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Bookends Maintenance',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      home: const _Root(),
    );
  }
}

/// Picks the shell like the web app: admins get the admin app, everyone else the worker app.
class _Root extends StatelessWidget {
  const _Root();

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    if (s.restoring) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (!s.signedIn) return const LoginScreen();
    if (s.user?['mustChangePassword'] == true) return const ChangePasswordScreen();
    // Keyed by user so switching accounts starts from a fresh shell.
    final key = ValueKey(s.user?['id']);
    return s.isAdmin ? AdminShell(key: key) : WorkerShell(key: key);
  }
}
