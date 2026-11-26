import 'package:flutter/material.dart';
import '../../core/theme.dart';
import 'package:provider/provider.dart';
import 'package:dio/dio.dart';
import '../../core/api_client.dart';
import '../../core/config.dart';
import 'auth_provider.dart';
import '../tech/v2.dart';

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
      // the controller is disposed once the dialog has fully faded out
      builder: (ctx) => DisposeOnUnmount(
        onDispose: controller.dispose,
        child: StatefulBuilder(
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
      ),
    );
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
    // the v2 sign-in, shared by every role
    return V2Scope(
      child: Builder(builder: (context) {
        final c = context.v;
        return Scaffold(
          backgroundColor: c.bg,
          body: SafeArea(
            child: Stack(children: [
              Center(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(24, 48, 24, 24),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 400),
                    child: AutofillGroup(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Center(
                            child: Container(
                              width: 64,
                              height: 64,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(color: c.acf, borderRadius: BorderRadius.circular(20)),
                              child: const V2Icon(V2Icons.building, size: 30, color: Colors.white),
                            ),
                          ),
                          const SizedBox(height: 12),
                          Text('FACILITRACK',
                              textAlign: TextAlign.center,
                              style: v2Text(size: 22, weight: FontWeight.w800, spacing: -0.3, color: c.tx, height: 1.3)),
                          const SizedBox(height: 2),
                          const Meta('CvSU Imus · General Services', align: TextAlign.center),
                          const SizedBox(height: 28),
                          const Center(child: H1('Sign in', size: 24)),
                          const SizedBox(height: 4),
                          const Sub('Use the account given to you by the GSO.', align: TextAlign.center),
                          const SizedBox(height: 28),
                          V2Field('Email',
                              child: V2Input(
                                controller: email,
                                keyboard: TextInputType.emailAddress,
                                autofill: const [AutofillHints.email],
                                hint: 'name@cvsu.edu.ph',
                              )),
                          const SizedBox(height: 28),
                          V2Field('Password',
                              child: V2Input(
                                controller: password,
                                obscure: !showPassword,
                                autofill: const [AutofillHints.password],
                                onSubmitted: (_) => busy ? null : submit(),
                                trailing: GestureDetector(
                                  onTap: () => setState(() => showPassword = !showPassword),
                                  child: Semantics(
                                    button: true,
                                    label: showPassword ? 'Hide password' : 'Show password',
                                    child: V2Icon(showPassword ? V2Icons.eyeOff : V2Icons.eye, size: 17, color: c.tx3),
                                  ),
                                ),
                              )),
                          if (error != null) ...[
                            const SizedBox(height: 12),
                            Text(error!, style: v2Text(size: 13.5, color: c.red)),
                          ],
                          const SizedBox(height: 28),
                          V2Button('Sign in', kind: BtnKind.pri, size: BtnSize.lg, block: true, busy: busy, onPressed: submit),
                          const SizedBox(height: 28),
                          const Meta(
                            'Students, faculty, staff and technicians sign in here.\nForgot your password? Ask the GSO to reset it.',
                            align: TextAlign.center,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              Positioned(
                top: 8,
                right: 12,
                child: V2IconButton(V2Icons.devices,
                    tooltip: 'Server settings', plain: true, onPressed: busy ? null : openServerSettings),
              ),
            ]),
          ),
        );
      }),
    );
  }
}
