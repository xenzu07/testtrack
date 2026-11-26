// Shared pieces of the reporter app (v2 design).
import 'package:flutter/material.dart';
import '../tech/v2.dart';

/// Priority label from a report's urgency (urgency and priority are one level).
String? priorityOf(Map r) =>
    const {'CRITICAL': 'P1', 'HIGH': 'P2', 'MEDIUM': 'P3', 'LOW': 'P4'}[r['urgency']];

/// "Old Building · Room 204".
String placeShort(Map? loc) =>
    [loc?['building'], loc?['room']].where((x) => x != null && '$x'.isNotEmpty).join(' · ');

/// "Old Building · 2nd Floor · Room 204".
String placeLong(Map? loc) =>
    [loc?['building'], loc?['floor'], loc?['room']].where((x) => x != null && '$x'.isNotEmpty).join(' · ');

/// The job order working on a report (a linked report follows its main one).
Map? activeJob(Map r) {
  final linked = r['duplicateOf'];
  if (linked is Map && linked['jobOrder'] != null) return linked['jobOrder'] as Map;
  final own = r['jobOrder'];
  if (own is Map && own['status'] != 'CANCELLED') return own;
  return null;
}

String? techName(Map r) => activeJob(r)?['technician']?['fullName'] as String?;

/// When the report last reached [status] (from its history), local time.
String? reachedAt(Map r, String status) {
  final logs = (r['logs'] as List? ?? const []).cast<Map>();
  for (final l in logs.reversed) {
    if (l['newStatus'] == status && l['oldStatus'] != status) return l['createdAt'] as String?;
  }
  return null;
}

bool needsRating(Map r) => r['status'] == 'CLOSED' && r['feedback'] == null;
bool formReturned(Map r) => r['jobOrderForm']?['status'] == 'RETURNED';
bool formMissing(Map r) => r['jobOrderForm'] == null && r['status'] != 'CLOSED' && r['duplicateOfId'] == null;
bool needsYou(Map r) => needsRating(r) || formReturned(r) || formMissing(r);

/// The report's status as a dot and words, in the reporter's terms.
StatusDot reportStatus(Map r, {bool withTarget = false}) {
  final target = activeJob(r)?['targetDate'];
  final t = withTarget && target != null ? ' · Target ${shortDay(target)}' : '';
  switch (r['status']) {
    case 'SUBMITTED':
      return const StatusDot('Sent', StKind.neutral);
    case 'UNDER_REVIEW':
      return const StatusDot('Under Review', StKind.neutral);
    case 'ASSIGNED':
      return StatusDot('Assigned$t', StKind.tech);
    case 'IN_PROGRESS':
      return StatusDot('Being Fixed$t', StKind.work);
    case 'DELAYED':
      return StatusDot('Paused$t', StKind.wait);
    case 'COMPLETED':
      return const StatusDot('GSO Checking', StKind.check);
    case 'CLOSED':
      return const StatusDot('Closed', StKind.done);
    default:
      return StatusDot('${r['status']}', StKind.neutral);
  }
}

/// Job Order Form status in the design's words.
StatusDot formStatus(String? s) => switch (s) {
      'APPROVED' => const StatusDot('Approved', StKind.done),
      'RECEIVED' => const StatusDot('Received', StKind.tech),
      'RETURNED' => const StatusDot('Needs changes', StKind.wait),
      _ => const StatusDot('Sent', StKind.neutral),
    };

/// "10:20 AM" today, otherwise "Nov 24".
String timeOrDay(Object? iso) {
  final d = DateTime.tryParse('${iso ?? ''}')?.toLocal();
  if (d == null) return '';
  final now = DateTime.now();
  if (d.year == now.year && d.month == now.month && d.day == now.day) return clock(d);
  return shortLocalDay(iso);
}

/// "9:29 AM".
String clock(DateTime d) {
  final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
  return '$h:${d.minute.toString().padLeft(2, '0')} ${d.hour < 12 ? 'AM' : 'PM'}';
}

/// "Nov 26, 9:29 AM".
String dayAndTime(Object? iso) {
  final d = DateTime.tryParse('${iso ?? ''}')?.toLocal();
  if (d == null) return '';
  return '${shortLocalDay(iso)}, ${clock(d)}';
}

/// Avatar colour for reporters (the design's pink).
const reporterColor = Color(0xFFD6456A);

/// "See all"-style text link.
class TextLink extends StatelessWidget {
  final String text;
  final VoidCallback onTap;
  const TextLink(this.text, {super.key, required this.onTap});

  @override
  Widget build(BuildContext context) => Semantics(
        link: true,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(6),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 4),
            child: Text(text, style: v2Text(size: 13, weight: FontWeight.w700, color: context.v.ac)),
          ),
        ),
      );
}

/// Grid of equal option buttons (`.opt`), two per row.
class OptGrid<T> extends StatelessWidget {
  final List<(T, String)> options;
  final T? value;
  final ValueChanged<T> onChanged;
  const OptGrid({super.key, required this.options, required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    final rows = <Widget>[];
    for (var i = 0; i < options.length; i += 2) {
      rows.add(Row(children: [
        for (var k = i; k < i + 2; k++) ...[
          if (k > i) const SizedBox(width: 8),
          Expanded(
            child: k >= options.length
                ? const SizedBox.shrink()
                : Semantics(
                    selected: options[k].$1 == value,
                    button: true,
                    child: Material(
                      color: options[k].$1 == value ? c.acs : Colors.transparent,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                        side: BorderSide(color: options[k].$1 == value ? c.acl : c.line2),
                      ),
                      clipBehavior: Clip.antiAlias,
                      child: InkWell(
                        onTap: () => onChanged(options[k].$1),
                        child: SizedBox(
                          height: 44,
                          child: Center(
                            child: Text(options[k].$2,
                                style: v2Text(
                                    size: 14,
                                    weight: options[k].$1 == value ? FontWeight.w700 : FontWeight.w600,
                                    color: options[k].$1 == value ? c.ac : c.tx2,
                                    height: 1)),
                          ),
                        ),
                      ),
                    ),
                  ),
          ),
        ],
      ]));
    }
    return Column(children: [
      for (var i = 0; i < rows.length; i++) ...[if (i > 0) const SizedBox(height: 8), rows[i]],
    ]);
  }
}

/// The certify tick box with its sentence.
class CertifyRow extends StatelessWidget {
  final bool on;
  final ValueChanged<bool> onChanged;
  final bool error;
  const CertifyRow({super.key, required this.on, required this.onChanged, this.error = false});

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    return Semantics(
      checked: on,
      child: InkWell(
        onTap: () => onChanged(!on),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            width: 22,
            height: 22,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: on ? c.acf : null,
              borderRadius: BorderRadius.circular(7),
              border: on ? null : Border.all(color: error ? c.red : c.line2, width: 1.6),
            ),
            child: on ? const V2Icon(V2Icons.check, size: 14, color: Colors.white) : null,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text('I certify this request is true and correct.',
                style: v2Text(size: 13.5, color: error ? c.red : c.tx2)),
          ),
        ]),
      ),
    );
  }
}
