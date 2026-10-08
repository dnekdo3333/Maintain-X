import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/session.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.subtitle, this.size = 40});
  final String? subtitle;
  final double size;
  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [
        Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            gradient: AppColors.brand,
            borderRadius: BorderRadius.circular(size * 0.28),
            boxShadow: [
              BoxShadow(color: AppColors.brandTo.withValues(alpha: 0.4), blurRadius: 12, offset: const Offset(0, 4)),
            ],
          ),
          child: Icon(Icons.build_rounded, color: Colors.white, size: size * 0.5),
        ),
        const SizedBox(width: 10),
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Bookends Maintenance',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: AppColors.foreground)),
          if (subtitle != null)
            Text(subtitle!, style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
        ]),
      ]);
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _id = TextEditingController();
  final _pw = TextEditingController();
  late final TextEditingController _server;
  bool _busy = false;
  bool _hide = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _server = TextEditingController(text: context.read<Session>().api.server);
  }

  Future<void> _submit() async {
    if (_id.text.trim().isEmpty || _pw.text.isEmpty) {
      setState(() => _error = 'Login ID aur password dono bharein.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final s = context.read<Session>();
    try {
      if (_server.text.trim() != s.api.server) await s.setServer(_server.text);
      await s.login(_id.text, _pw.text);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                const Center(child: BrandMark(size: 44)),
                const SizedBox(height: 28),
                AppCard(
                  padding: const EdgeInsets.all(22),
                  child: AutofillGroup(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      const Text('Sign in to your account',
                          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600)),
                      const SizedBox(height: 4),
                      const Text('Use your email, username or phone.',
                          style: TextStyle(color: AppColors.muted)),
                      const SizedBox(height: 20),
                      TextField(
                        controller: _id,
                        autofillHints: const [AutofillHints.username],
                        textInputAction: TextInputAction.next,
                        keyboardType: TextInputType.emailAddress,
                        decoration: const InputDecoration(
                            labelText: 'Email, username or phone',
                            prefixIcon: Icon(Icons.person_outline)),
                      ),
                      const SizedBox(height: 14),
                      TextField(
                        controller: _pw,
                        obscureText: _hide,
                        autofillHints: const [AutofillHints.password],
                        onSubmitted: (_) => _submit(),
                        decoration: InputDecoration(
                          labelText: 'Password',
                          prefixIcon: const Icon(Icons.lock_outline),
                          suffixIcon: IconButton(
                            icon: Icon(_hide ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                            onPressed: () => setState(() => _hide = !_hide),
                          ),
                        ),
                      ),
                      if (_error != null) ...[
                        const SizedBox(height: 14),
                        Callout(text: _error!, tone: 'danger'),
                      ],
                      const SizedBox(height: 18),
                      FilledButton(
                        onPressed: _busy ? null : _submit,
                        child: _busy
                            ? const SizedBox(
                                width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
                            : const Text('Sign in'),
                      ),
                    ]),
                  ),
                ),
                const SizedBox(height: 16),
                Theme(
                  data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
                  child: ExpansionTile(
                    tilePadding: const EdgeInsets.symmetric(horizontal: 4),
                    leading: const Icon(Icons.dns_outlined, color: AppColors.muted),
                    title: const Text('Server address', style: TextStyle(fontSize: 14, color: AppColors.muted)),
                    children: [
                      TextField(
                        controller: _server,
                        keyboardType: TextInputType.url,
                        decoration: const InputDecoration(
                          hintText: 'http://192.168.1.10:4000',
                          helperText: 'PC ka IP (npm run dev wala) ya Vercel ka URL',
                        ),
                      ),
                      const SizedBox(height: 8),
                    ],
                  ),
                ),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}

/// First sign-in with a temporary password: choose a new one (same rule as the web).
class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key});
  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  bool _busy = false;
  String? _error;

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final s = context.read<Session>();
    try {
      final session = await s.api.postData<Map<String, dynamic>>(
          '/auth/change-password', {'currentPassword': _current.text, 'newPassword': _next.text});
      s.adopt(session);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Choose a new password'), actions: [
        TextButton(onPressed: () => context.read<Session>().logout(), child: const Text('Sign out')),
      ]),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        const Callout(text: 'For security, please set your own password before continuing.'),
        const SizedBox(height: 16),
        TextField(
            controller: _current,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'Current password')),
        const SizedBox(height: 12),
        TextField(
            controller: _next,
            obscureText: true,
            decoration: const InputDecoration(
                labelText: 'New password', helperText: 'At least 8 characters with letters and numbers')),
        if (_error != null) ...[const SizedBox(height: 12), Callout(text: _error!, tone: 'danger')],
        const SizedBox(height: 16),
        FilledButton(onPressed: _busy ? null : _save, child: const Text('Save password')),
      ]),
    );
  }
}
