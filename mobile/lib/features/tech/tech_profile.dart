import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/theme.dart';
import '../auth/account_menu.dart' show ChangePasswordDialog;
import '../auth/auth_provider.dart';
import '../notifications/notifications.dart';
import '../survey/skills_survey_screen.dart';
import 'tech_notifications.dart';
import 'v2.dart';

class TechProfileTab extends StatefulWidget {
  const TechProfileTab({super.key});

  @override
  State<TechProfileTab> createState() => _TechProfileTabState();
}

class _TechProfileTabState extends State<TechProfileTab> {
  List<Map> roles = [];
  String? takenAt;

  @override
  void initState() {
    super.initState();
    load();
  }

  // the technical roles (with scores) and when the skills survey was taken
  Future<void> load() async {
    try {
      final res = await ApiClient.instance.dio.get('/technicians/survey');
      final status = res.data['status'] as Map?;
      roles = List<Map>.from(status?['roles'] as List? ?? const [])
        ..sort((a, b) => (b['score'] as num).compareTo(a['score'] as num));
      takenAt = status?['completedAt'] as String?;
    } catch (_) {
      // the profile still shows without the roles
    }
    if (mounted) setState(() {});
  }

  Future<void> signOutEverywhere() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Sign out of all devices?', style: v2Text(size: 18, weight: FontWeight.w700, color: ctx.v.tx)),
        content: Text('You will be signed out here and on every other phone or browser.',
            style: v2Text(color: ctx.v.tx2)),
        actions: [
          V2Button('Cancel', kind: BtnKind.ghost, onPressed: () => Navigator.pop(ctx, false)),
          V2Button('Sign out', kind: BtnKind.pri, onPressed: () => Navigator.pop(ctx, true)),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await context.read<AuthProvider>().logoutEverywhere();
    } catch (e) {
      if (mounted) v2Snack(context, errorMessage(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    final u = context.watch<AuthProvider>().user;
    final unread = context.watch<NotificationsController>().unread;
    final theme = context.watch<ThemeController>();

    return Column(children: [
      const MTop(padding: EdgeInsets.fromLTRB(20, 24, 20, 14), children: [Expanded(child: H1('Profile', size: 24))]),
      Expanded(
        child: MBody(
          onRefresh: load,
          children: [
            MCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Avatar(u?.fullName ?? '', size: 44),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(u?.fullName ?? '', style: v2Text(size: 17, weight: FontWeight.w700, color: c.tx, height: 1.35)),
                      Meta(['Technician', if (u?.email != null) u!.email!].join(' · ')),
                    ]),
                  ),
                ]),
                if (roles.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  Wrap(spacing: 8, runSpacing: 8, children: [
                    for (final r in roles) V2Tag('${r['tradeUnit']?['name']} ${r['score']}', tone: TagTone.good),
                  ]),
                ],
              ]),
            ),
            CardRows([
              _row(V2Icons.bell, 'Notifications',
                  trailing: unread > 0 ? CountBadge(unread, hot: true) : null,
                  onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const TechNotificationsScreen()))),
              _row(V2Icons.cap, 'Update my skills',
                  trailing: takenAt == null ? null : Meta('Taken ${shortLocalDay(takenAt)}'), onTap: () async {
                await Navigator.push(context, MaterialPageRoute(builder: (_) => const SkillsSurveyScreen()));
                load();
              }),
              _row(V2Icons.moon, 'Dark mode', trailing: _Toggle(on: theme.isDark), onTap: theme.toggle),
            ]),
            CardRows([
              _row(V2Icons.lock, 'Change password',
                  onTap: () => showDialog(context: context, builder: (_) => const ChangePasswordDialog())),
              _row(V2Icons.devices, 'Sign out of all devices', onTap: signOutEverywhere),
              _row(V2Icons.logout, 'Sign out', color: c.red, onTap: () => context.read<AuthProvider>().logout()),
            ]),
            const Meta('FACILITRACK · CvSU Imus General Services Office', align: TextAlign.center),
          ],
        ),
      ),
    ]);
  }

  Widget _row(String icon, String label, {Widget? trailing, Color? color, VoidCallback? onTap}) {
    final c = context.v;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(children: [
          V2Icon(icon, size: 20, color: color ?? c.tx3),
          const SizedBox(width: 12),
          Expanded(child: Text(label, style: v2Text(size: 14.5, weight: FontWeight.w600, color: color ?? c.tx))),
          if (trailing != null) ...[const SizedBox(width: 8), rowEnd(context, trailing)],
        ]),
      ),
    );
  }
}

class _Toggle extends StatelessWidget {
  final bool on;
  const _Toggle({required this.on});

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    return Semantics(
      toggled: on,
      label: 'Dark mode ${on ? 'on' : 'off'}',
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        width: 44,
        height: 26,
        padding: const EdgeInsets.all(3),
        alignment: on ? Alignment.centerRight : Alignment.centerLeft,
        decoration: BoxDecoration(color: on ? c.acf : c.line2, borderRadius: BorderRadius.circular(13)),
        child: Container(width: 20, height: 20, decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle)),
      ),
    );
  }
}
