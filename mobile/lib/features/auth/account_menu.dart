import 'package:flutter/material.dart';
import '../../core/theme.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import 'auth_provider.dart';
import '../survey/skills_survey_screen.dart';
import '../analytics/my_performance_screen.dart';

enum _Action { performance, skills, changePassword, logoutAll, logout }

/// App-bar menu with the signed-in user's name and account actions.
class AccountMenuButton extends StatelessWidget {
  const AccountMenuButton({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final u = auth.user;
    return PopupMenuButton<_Action>(
      tooltip: 'Account',
      icon: CircleAvatar(
        radius: 15,
        backgroundColor: context.c.greenSoft,
        foregroundColor: Theme.of(context).colorScheme.primary,
        child: Text(
          (u?.fullName.trim().isNotEmpty ?? false)
              ? u!.fullName.trim()[0].toUpperCase()
              : '?',
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
        ),
      ),
      onSelected: (a) async {
        switch (a) {
          case _Action.performance:
            await Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const MyPerformanceScreen()),
            );
          case _Action.skills:
            await Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const SkillsSurveyScreen()),
            );
          case _Action.changePassword:
            await showDialog(
                context: context, builder: (_) => const ChangePasswordDialog());
          case _Action.logoutAll:
            final ok = await showDialog<bool>(
              context: context,
              builder: (ctx) => AlertDialog(
                title: const Text('Sign out of all devices?'),
                content: const Text(
                    'You will be signed out here and on every other phone or browser.'),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(ctx, false),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      child: const Text('Sign out')),
                ],
              ),
            );
            if (ok != true || !context.mounted) return;
            try {
              await context.read<AuthProvider>().logoutEverywhere();
            } catch (e) {
              if (context.mounted) {
                ScaffoldMessenger.of(context)
                    .showSnackBar(SnackBar(content: Text(errorMessage(e))));
              }
            }
          case _Action.logout:
            await context.read<AuthProvider>().logout();
        }
      },
      itemBuilder: (_) => [
        PopupMenuItem(
          enabled: false,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(u?.fullName ?? '',
                  style: TextStyle(
                      fontWeight: FontWeight.w700, color: context.c.text)),
              Text(
                [
                  if (u != null) u.role[0] + u.role.substring(1).toLowerCase(),
                  if (u?.tradeUnitName != null) u!.tradeUnitName!,
                ].join(' · '),
                style: TextStyle(fontSize: 12, color: context.c.muted),
              ),
            ],
          ),
        ),
        const PopupMenuDivider(),
        if (u?.role == 'TECHNICIAN')
          const PopupMenuItem(
            value: _Action.performance,
            child: ListTile(
                leading: Icon(Icons.insights),
                title: Text('My performance'),
                contentPadding: EdgeInsets.zero),
          ),
        if (u?.role == 'TECHNICIAN')
          const PopupMenuItem(
            value: _Action.skills,
            child: ListTile(
                leading: Icon(Icons.workspace_premium),
                title: Text('Update my skills'),
                contentPadding: EdgeInsets.zero),
          ),
        const PopupMenuItem(
          value: _Action.changePassword,
          child: ListTile(
              leading: Icon(Icons.lock_reset),
              title: Text('Change password'),
              contentPadding: EdgeInsets.zero),
        ),
        const PopupMenuItem(
          value: _Action.logoutAll,
          child: ListTile(
              leading: Icon(Icons.devices),
              title: Text('Sign out of all devices'),
              contentPadding: EdgeInsets.zero),
        ),
        const PopupMenuItem(
          value: _Action.logout,
          child: ListTile(
              leading: Icon(Icons.logout),
              title: Text('Sign out'),
              contentPadding: EdgeInsets.zero),
        ),
      ],
    );
  }
}

class ChangePasswordDialog extends StatefulWidget {
  const ChangePasswordDialog({super.key});

  @override
  State<ChangePasswordDialog> createState() => _ChangePasswordDialogState();
}

class _ChangePasswordDialogState extends State<ChangePasswordDialog> {
  final current = TextEditingController();
  final next = TextEditingController();
  final confirm = TextEditingController();
  bool busy = false;
  String? error;

  @override
  void dispose() {
    current.dispose();
    next.dispose();
    confirm.dispose();
    super.dispose();
  }

  // same rules the server enforces, checked early for a clear message
  String? get problem {
    final n = next.text;
    if (n.isEmpty) return null;
    if (n.length < 8) return 'At least 8 characters.';
    if (!RegExp(r'[A-Za-z]').hasMatch(n)) return 'Include at least one letter.';
    if (!RegExp(r'\d').hasMatch(n)) return 'Include at least one number.';
    if (confirm.text.isNotEmpty && confirm.text != n) {
      return 'The new passwords do not match.';
    }
    return null;
  }

  bool get canSubmit =>
      !busy &&
      current.text.isNotEmpty &&
      next.text.isNotEmpty &&
      next.text == confirm.text &&
      problem == null;

  Future<void> submit() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final res = await ApiClient.instance.dio.post('/auth/change-password',
          data: {'currentPassword': current.text, 'newPassword': next.text});
      if (!mounted) return;
      await context
          .read<AuthProvider>()
          .replaceToken(res.data['accessToken'] as String);
      if (!mounted) return;
      Navigator.pop(context);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text(
              'Password changed. Other devices have been signed out.')));
    } catch (e) {
      if (mounted) {
        setState(() {
          busy = false;
          error = errorMessage(e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    InputDecoration dec(String label) =>
        InputDecoration(labelText: label, border: const OutlineInputBorder());
    return AlertDialog(
      title: Text('Change password'),
      content: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(
            controller: current,
            obscureText: true,
            autofillHints: const [AutofillHints.password],
            decoration: dec('Current password'),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: next,
            obscureText: true,
            autofillHints: const [AutofillHints.newPassword],
            decoration: dec('New password'),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: confirm,
            obscureText: true,
            decoration: dec('Confirm new password'),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 8),
          Text(problem ?? error ?? 'At least 8 characters, with a letter and a number.',
              style: TextStyle(
                  fontSize: 12,
                  color: (problem ?? error) != null ? context.c.danger : context.c.muted)),
        ]),
      ),
      actions: [
        TextButton(
            onPressed: busy ? null : () => Navigator.pop(context),
            child: const Text('Cancel')),
        FilledButton(
          onPressed: canSubmit ? submit : null,
          child: busy
              ? const SizedBox(
                  height: 18,
                  width: 18,
                  child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('Change'),
        ),
      ],
    );
  }
}
