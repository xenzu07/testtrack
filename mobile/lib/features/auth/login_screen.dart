import 'package:flutter/material.dart';
import '../../core/theme.dart';
import 'package:provider/provider.dart';
import 'package:dio/dio.dart';
import '../../core/api_client.dart';
import '../../core/config.dart';
import 'auth_provider.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final email = TextEditingController();
  final password = TextEditingController();
  bool busy = false;
  bool showPassword = false;
  String? error;

  @override
  void dispose() {
    email.dispose();
    password.dispose();
    super.dispose();
  }

  Future<void> openServerSettings() async {
    final controller = TextEditingController(text: AppConfig.baseUrl);
    String? status;
    bool testing = false;

    await showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: Text('Server address'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Use your PC\'s current IPv4 address (run ipconfig), e.g. '
                '192.168.1.15. Phone and PC must be on the same Wi-Fi. '
                'Android emulator: 10.0.2.2',
                style: TextStyle(fontSize: 12, color: context.c.muted),
              ),
              SizedBox(height: 12),
              TextField(
                controller: controller,
                keyboardType: TextInputType.url,
                autocorrect: false,
                enableSuggestions: false,
                decoration: const InputDecoration(
                  labelText: 'Server URL',
                  hintText: 'http://192.168.1.15:3000',
                  border: OutlineInputBorder(),
                ),
              ),
              if (status != null) ...[
                const SizedBox(height: 12),
                Text(status!,
                    style: TextStyle(
                        color: status!.startsWith('Connected')
                            ? context.c.success
                            : context.c.danger)),
              ],
            ],
          ),
          actions: [
            TextButton(
              onPressed: testing
                  ? null
                  : () async {
                      setLocal(() {
                        testing = true;
                        status = null;
                      });
                      final url = AppConfig.normalize(controller.text);
                      try {
                        await Dio(BaseOptions(
                          connectTimeout: const Duration(seconds: 5),
                          receiveTimeout: const Duration(seconds: 5),
                          // any HTTP answer means the server is reachable
                          validateStatus: (_) => true,
                        )).get(url);
                        status = 'Connected to $url';
                      } catch (_) {
                        status = 'Cannot reach $url';
                      }
                      setLocal(() => testing = false);
                    },
              child: Text(testing ? 'Testing...' : 'Test'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () async {
                await AppConfig.setBaseUrl(controller.text);
                ApiClient.instance.applyBaseUrl();
                if (ctx.mounted) Navigator.pop(ctx);
                if (mounted) setState(() => error = null);
              },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
    controller.dispose();
  }

  Future<void> submit() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await context
          .read<AuthProvider>()
          .login(email.text.trim().toLowerCase(), password.text);
    } catch (e) {
      error = errorMessage(e);
    }
    if (mounted) setState(() => busy = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        shape: const Border(),
        actions: [
          const ThemeToggleButton(),
          IconButton(
            tooltip: 'Server settings',
            icon: Icon(Icons.settings),
            onPressed: busy ? null : openServerSettings,
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Center(
                    child: Container(
                      width: 56,
                      height: 56,
                      decoration: BoxDecoration(
                        color: context.c.primaryButton,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: const Icon(Icons.home_work_outlined, size: 30, color: Colors.white),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text('FACILITRACK',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                          fontSize: 24, fontWeight: FontWeight.w700, letterSpacing: 1, color: context.c.text)),
                  const SizedBox(height: 4),
                  Text('CvSU Imus · General Services',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: context.c.muted, fontSize: 14.5)),
                  const SizedBox(height: 32),
                  Text('Sign in', style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 4),
                  Text('Use the account given to you by the GSO.',
                      style: TextStyle(color: context.c.muted, fontSize: 14)),
                  const SizedBox(height: 20),
                  TextField(
                    controller: email,
                    keyboardType: TextInputType.emailAddress,
                    textInputAction: TextInputAction.next,
                    textCapitalization: TextCapitalization.none,
                    autocorrect: false,
                    enableSuggestions: false,
                    autofillHints: const [AutofillHints.email],
                    decoration: const InputDecoration(
                        labelText: 'Email', border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: password,
                    obscureText: !showPassword,
                    textInputAction: TextInputAction.done,
                    autocorrect: false,
                    enableSuggestions: false,
                    onSubmitted: (_) => busy ? null : submit(),
                    autofillHints: const [AutofillHints.password],
                    decoration: InputDecoration(
                      labelText: 'Password',
                      border: const OutlineInputBorder(),
                      suffixIcon: IconButton(
                        icon: Icon(showPassword
                            ? Icons.visibility_off
                            : Icons.visibility),
                        onPressed: () =>
                            setState(() => showPassword = !showPassword),
                      ),
                    ),
                  ),
                  if (error != null) ...[
                    const SizedBox(height: 12),
                    Text(error!, style: TextStyle(color: context.c.danger)),
                  ],
                  SizedBox(height: 8),
                  Text(
                    'Server: ${AppConfig.baseUrl}',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 11, color: context.c.muted),
                  ),
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: busy ? null : submit,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      child: busy
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(strokeWidth: 2))
                          : const Text('Sign in'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}