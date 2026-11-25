import 'package:flutter/material.dart';
import 'config.dart';
import 'theme.dart';

String statusLabel(String s) => s
    .split('_')
    .map((w) => w[0] + w.substring(1).toLowerCase())
    .join(' ');

String urgencyLabel(String s) => s[0] + s.substring(1).toLowerCase();

// same status colours as the web dashboard
Color statusColor(String s) {
  switch (s) {
    case 'SUBMITTED':
      return const Color(0xFF8D968F);
    case 'UNDER_REVIEW':
      return const Color(0xFF8B5FC8);
    case 'ASSIGNED':
      return const Color(0xFF3B6FD0);
    case 'IN_PROGRESS':
      return const Color(0xFFD08A12);
    case 'COMPLETED':
      return const Color(0xFF2E9A55);
    case 'DELAYED':
      return const Color(0xFFD4502A);
    case 'CLOSED':
      return const Color(0xFF4C5650);
    default:
      return const Color(0xFFB9BFBA);
  }
}

const _monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// "Nov 25, 2026" (a calendar day, no time).
String formatCalendarDay(DateTime d) => '${_monthNames[d.month - 1]} ${d.day}, ${d.year}';

/// "Nov 25, 2026, 1:22 PM" in the phone's local time, the same style as the
/// web dashboard.
String formatDate(String iso) {
  final d = DateTime.parse(iso).toLocal();
  final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
  final m = d.minute.toString().padLeft(2, '0');
  return '${formatCalendarDay(d)}, $h:$m ${d.hour < 12 ? 'AM' : 'PM'}';
}

class StatusChip extends StatelessWidget {
  final String status;
  const StatusChip(this.status, {super.key});

  @override
  Widget build(BuildContext context) {
    final color = statusColor(status);
    // a coloured dot + plain text keeps lists calm; colour is secondary to the word
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Container(
        width: 7,
        height: 7,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      ),
      const SizedBox(width: 6),
      Text(
        statusLabel(status),
        style: TextStyle(color: context.c.text2, fontWeight: FontWeight.w500, fontSize: 13.5),
      ),
    ]);
  }
}

// one entry of a report's status history, with progress updates and photos;
// drawn as a timeline (dot + connecting line), like the web dashboard
class HistoryTile extends StatelessWidget {
  final Map<String, dynamic> log;
  final bool last;
  const HistoryTile(this.log, {super.key, this.last = false});

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final newStatus = log['newStatus'] as String;
    final isProgress =
        log['oldStatus'] == 'IN_PROGRESS' && newStatus == 'IN_PROGRESS';
    final remarks = log['remarks'] as String?;
    final photoUrl = AppConfig.mediaUrl(log['photoUrl']);

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 20,
            child: Column(children: [
              const SizedBox(height: 6),
              Container(
                width: 9,
                height: 9,
                decoration: BoxDecoration(
                  color: statusColor(isProgress ? 'IN_PROGRESS' : newStatus),
                  shape: BoxShape.circle,
                ),
              ),
              if (!last)
                Expanded(child: Container(width: 1, margin: const EdgeInsets.only(top: 4), color: c.border)),
            ]),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: last ? 0 : 18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Expanded(
                      child: Text(isProgress ? 'Progress update' : statusLabel(newStatus),
                          style: TextStyle(fontWeight: FontWeight.w600, color: c.text, fontSize: 14.5)),
                    ),
                    Text(formatDate(log['createdAt'] as String),
                        style: TextStyle(color: c.muted, fontSize: 12.5)),
                  ]),
                  if (remarks != null && remarks.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text(remarks, style: TextStyle(color: c.text2, fontSize: 14, height: 1.4)),
                    ),
                  if (photoUrl != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: Image.network(
                          photoUrl,
                          height: 150,
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) => Container(
                            height: 150,
                            color: c.hover,
                            alignment: Alignment.center,
                            child: Text('Photo could not be loaded', style: TextStyle(color: c.muted)),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The whole status history as one timeline.
class HistoryTimeline extends StatelessWidget {
  final List logs;
  const HistoryTimeline(this.logs, {super.key});

  @override
  Widget build(BuildContext context) => Column(children: [
        for (var i = 0; i < logs.length; i++)
          HistoryTile(Map<String, dynamic>.from(logs[i]), last: i == logs.length - 1),
      ]);
}
