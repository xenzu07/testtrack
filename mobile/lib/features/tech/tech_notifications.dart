import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/push.dart';
import '../notifications/notifications.dart';
import 'v2.dart';

/// "12 min", "1 h", "yesterday" or "Nov 24".
String _ago(String iso) {
  final d = DateTime.tryParse(iso)?.toLocal();
  if (d == null) return '';
  final diff = DateTime.now().difference(d);
  if (diff.inMinutes < 1) return 'now';
  if (diff.inMinutes < 60) return '${diff.inMinutes} min';
  if (diff.inHours < 24) return '${diff.inHours} h';
  if (diff.inDays == 1) return 'yesterday';
  if (diff.inDays < 7) return '${diff.inDays} days';
  return shortLocalDay(iso);
}

/// Icon and colour for a notification, as in the design.
({String icon, Color color}) _look(Map n) {
  final title = '${n['title']}'.toLowerCase();
  switch (n['kind']) {
    case 'job.offered':
      return (icon: V2Icons.inbox, color: const Color(0xFF1F9D57));
    case 'job.withdrawn':
      return (icon: V2Icons.close, color: const Color(0xFF4F6258));
    case 'job.verified':
      return title.contains('rework')
          ? (icon: V2Icons.alert, color: const Color(0xFFD6456A))
          : (icon: V2Icons.check, color: const Color(0xFF1F9D57));
    case 'form.status':
      return title.contains('return') || title.contains('change')
          ? (icon: V2Icons.alert, color: const Color(0xFFD6456A))
          : (icon: V2Icons.doc, color: const Color(0xFF1F9D57));
    default:
      if (title.contains('verified') || title.contains('received') || title.contains('confirmed')) {
        return (icon: V2Icons.check, color: const Color(0xFF1F9D57));
      }
      if (title.contains('reopened') || title.contains('rework')) {
        return (icon: V2Icons.alert, color: const Color(0xFFD6456A));
      }
      if (title.contains('delayed') || title.contains('waiting') || title.contains('due') || title.contains('target')) {
        return (icon: V2Icons.clock, color: const Color(0xFFD9711A));
      }
      if (title.contains('started') || title.contains('progress') || title.contains('resumed') || title.contains('completed')) {
        return (icon: V2Icons.bolt, color: const Color(0xFFD9711A));
      }
      if (title.contains('job order') || title.contains('linked')) {
        return (icon: V2Icons.doc, color: const Color(0xFF2F6FE0));
      }
      return (icon: V2Icons.bell, color: const Color(0xFFD9711A));
  }
}

class TechNotificationsScreen extends StatelessWidget {
  const TechNotificationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return V2Scope(
      child: Builder(builder: (context) {
        final c = context.v;
        final n = context.watch<NotificationsController>();
        return Scaffold(
          backgroundColor: c.bg,
          body: Column(children: [
            BackTop(
              'Notifications',
              trailing: n.unread > 0
                  ? V2Button('Mark all read', kind: BtnKind.ghost, size: BtnSize.sm, onPressed: n.markAllRead)
                  : null,
            ),
            Expanded(
              child: MBody(
                bottom: 32,
                onRefresh: n.load,
                children: [
                  if (PushService.instance.state == 'denied')
                    Note.text(
                        'Notifications are blocked for FACILITRACK. Allow them in your phone settings to get alerts when the app is closed.',
                        icon: V2Icons.warning,
                        warn: true),
                  if (n.error != null) Note.text(n.error!, icon: V2Icons.alert),
                  if (n.loading && n.items.isEmpty)
                    Padding(padding: const EdgeInsets.all(32), child: Center(child: CircularProgressIndicator(color: c.ac)))
                  else if (n.items.isEmpty)
                    Note.text('You have no notifications yet.', icon: V2Icons.info)
                  else
                    CardRows([for (final item in n.items) _Row(item)]),
                  if (n.hasMore) V2Button('Load older', block: true, onPressed: n.loadMore),
                ],
              ),
            ),
          ]),
        );
      }),
    );
  }
}

class _Row extends StatelessWidget {
  final Map<String, dynamic> n;
  const _Row(this.n);

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    final unread = n['readAt'] == null;
    final look = _look(n);
    return Material(
      color: unread ? c.s2 : Colors.transparent,
      child: InkWell(
        onTap: () {
          context.read<NotificationsController>().markRead(n);
          openNotificationTarget(n);
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            IconSquare(look.icon, look.color),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Expanded(
                    child: Text('${n['title']}', style: v2Text(size: 14.5, weight: FontWeight.w700, color: c.tx, height: 1.35)),
                  ),
                  const SizedBox(width: 8),
                  Meta(_ago(n['createdAt'] as String)),
                ]),
                const SizedBox(height: 2),
                Sub('${n['body']}', size: 13.5),
              ]),
            ),
            if (unread) ...[
              const SizedBox(width: 12),
              const Padding(padding: EdgeInsets.only(top: 4), child: UnreadDot()),
            ],
          ]),
        ),
      ),
    );
  }
}
