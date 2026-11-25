import 'package:flutter/material.dart';
import 'format.dart';
import 'theme.dart';

// Shared pieces for every screen. Colours come from the theme (context.c),
// so the same widget reads well in dark and light mode.

/// Open work that the technician has not finished yet.
const activeJobStatuses = {'ASSIGNED', 'IN_PROGRESS', 'DELAYED'};

/// Reports that are still being handled (not completed or closed).
bool isOpenReport(String status) => status != 'COMPLETED' && status != 'CLOSED';

const urgencyRank = {'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3};

/// Computed priority (set by the coordinator's system), P1 = most important.
const priorityRank = {'P1': 0, 'P2': 1, 'P3': 2, 'P4': 3};
const priorityLabel = {'P1': 'Critical', 'P2': 'High', 'P3': 'Medium', 'P4': 'Low'};

/// Priority takes colour only when it matters (P1 red, P2 amber).
Color priorityColor(BuildContext context, String? p) {
  final c = context.c;
  switch (p) {
    case 'P1':
      return c.danger;
    case 'P2':
      return c.warn;
    default:
      return c.muted;
  }
}

class PriorityPill extends StatelessWidget {
  final String? priority;
  const PriorityPill(this.priority, {super.key});

  @override
  Widget build(BuildContext context) => priority == null
      ? const SizedBox.shrink()
      : Pill('$priority ${priorityLabel[priority] ?? ''}', priorityColor(context, priority));
}

Color urgencyColor(BuildContext context, String u) {
  final c = context.c;
  switch (u) {
    case 'CRITICAL':
      return c.danger;
    case 'HIGH':
      return c.warn;
    case 'MEDIUM':
      return c.info;
    default:
      return c.muted;
  }
}

/// Target dates are stored as UTC midnight; overdue once that day has passed.
bool isOverdue(Map job) {
  final t = job['targetDate'];
  if (t == null || !activeJobStatuses.contains(job['status'])) return false;
  final now = DateTime.now().toUtc();
  final today = DateTime.utc(now.year, now.month, now.day);
  return DateTime.parse(t as String).isBefore(today);
}

/// "2026-11-25" for a UTC-midnight date such as a target date.
String formatDay(Object? iso) =>
    iso == null ? 'Not set' : iso.toString().substring(0, 10);

String timeAgo(String iso) {
  final diff = DateTime.now().difference(DateTime.parse(iso).toLocal());
  if (diff.inMinutes < 1) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
  if (diff.inHours < 24) return '${diff.inHours} h ago';
  final days = diff.inDays;
  if (days < 14) return days == 1 ? '1 day ago' : '$days days ago';
  return formatDate(iso).substring(0, 10);
}

/// The most recent history entry of a report, or its submission time.
String lastActivity(Map report) {
  final logs = report['logs'] as List? ?? const [];
  return logs.isEmpty
      ? report['createdAt'] as String
      : logs.last['createdAt'] as String;
}

/// Small tinted label, e.g. "P1 Critical" or "Approved". In dark mode the text
/// is lightened so it stays readable on the dark surface.
class Pill extends StatelessWidget {
  final String text;
  final Color color;
  final IconData? icon;
  const Pill(this.text, this.color, {super.key, this.icon});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final fg = dark ? Color.lerp(color, Colors.white, 0.25)! : color;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: dark ? 0.18 : 0.1),
        borderRadius: BorderRadius.circular(5),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[
          Icon(icon, size: 14, color: fg),
          const SizedBox(width: 4),
        ],
        Text(text, style: TextStyle(color: fg, fontSize: 12.5, fontWeight: FontWeight.w600)),
      ]),
    );
  }
}

class UrgencyPill extends StatelessWidget {
  final String urgency;
  const UrgencyPill(this.urgency, {super.key});

  @override
  Widget build(BuildContext context) => Pill(urgencyLabel(urgency), urgencyColor(context, urgency));
}

const _steps = [
  ('SUBMITTED', 'Submitted'),
  ('UNDER_REVIEW', 'Review'),
  ('ASSIGNED', 'Assigned'),
  ('IN_PROGRESS', 'Working'),
  ('COMPLETED', 'Done'),
  ('CLOSED', 'Verified'),
];

int progressIndex(String status) =>
    status == 'DELAYED' ? 3 : _steps.indexWhere((s) => s.$1 == status);

/// Where a report is on its way from submission to a verified repair.
class ProgressSteps extends StatelessWidget {
  final String status;
  const ProgressSteps(this.status, {super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final current = progressIndex(status);
    final delayed = status == 'DELAYED';
    final paused = statusColor('DELAYED');
    return Semantics(
      label: 'Progress: ${statusLabel(status)}',
      excludeSemantics: true,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < _steps.length; i++) ...[
            if (i > 0)
              Expanded(
                child: Container(
                  height: 2,
                  margin: const EdgeInsets.only(top: 11),
                  color: i <= current ? c.green : c.border,
                ),
              ),
            Column(mainAxisSize: MainAxisSize.min, children: [
              Container(
                width: 24,
                height: 24,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: i < current ? c.green : c.surface,
                  border: Border.all(
                    width: 2,
                    color: i < current
                        ? c.green
                        : i == current
                            ? (delayed ? paused : c.green)
                            : c.borderStrong,
                  ),
                ),
                child: i < current
                    ? Icon(Icons.check, size: 14, color: c.surface)
                    : Text('${i + 1}',
                        style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: i == current ? (delayed ? paused : c.green) : c.muted)),
              ),
              const SizedBox(height: 6),
              Text(
                delayed && i == current ? 'Delayed' : _steps[i].$2,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: i == current ? FontWeight.w700 : FontWeight.w400,
                  color: i == current ? (delayed ? paused : c.text) : c.muted,
                ),
              ),
            ]),
          ],
        ],
      ),
    );
  }
}

/// Plain-language "what happens next" for the reporter.
String nextStepText(String status, {bool hasFeedback = false}) {
  switch (status) {
    case 'SUBMITTED':
      return 'The coordinator will review your report and send it to the right team.';
    case 'UNDER_REVIEW':
      return 'Your report is being reviewed. A job order will be created next.';
    case 'ASSIGNED':
      return 'A job order was created. The technician will start work soon.';
    case 'IN_PROGRESS':
      return 'Work is in progress. Updates from the technician appear below.';
    case 'DELAYED':
      return 'Work is paused, usually while waiting for materials. It resumes once they arrive.';
    case 'COMPLETED':
      return 'The technician finished. The coordinator will check the work.';
    case 'CLOSED':
      return hasFeedback
          ? 'The repair was verified. Thank you for your feedback.'
          : 'The repair was verified. Please rate the work below.';
    default:
      return '';
  }
}

/// Keeps content readable on tablets and in landscape.
class ReadableWidth extends StatelessWidget {
  final Widget child;
  const ReadableWidth({super.key, required this.child});

  @override
  Widget build(BuildContext context) => Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: child,
        ),
      );
}

/// App-bar title with the FACILITRACK mark, used on the home screens
/// (the mobile counterpart of the web sidebar brand).
class BrandTitle extends StatelessWidget {
  final String title;
  const BrandTitle(this.title, {super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Row(children: [
      Container(
        width: 32,
        height: 32,
        decoration: BoxDecoration(color: c.primaryButton, borderRadius: BorderRadius.circular(8)),
        child: const Icon(Icons.home_work_outlined, size: 18, color: Colors.white),
      ),
      const SizedBox(width: 12),
      Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text(title, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: c.text)),
        Text('FACILITRACK · CvSU Imus',
            style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w500, color: c.muted, letterSpacing: 0.2)),
      ]),
    ]);
  }
}

/// A titled white (or dark) panel, like a card on the web dashboard.
class SectionCard extends StatelessWidget {
  final String? title;
  final Widget? trailing;
  final Widget child;
  final EdgeInsets padding;
  const SectionCard({
    super.key,
    this.title,
    this.trailing,
    required this.child,
    this.padding = const EdgeInsets.fromLTRB(16, 14, 16, 16),
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: padding,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (title != null) ...[
            Row(children: [
              Expanded(child: Text(title!, style: Theme.of(context).textTheme.titleMedium)),
              ?trailing,
            ]),
            const SizedBox(height: 12),
          ],
          child,
        ]),
      ),
    );
  }
}

/// Label on the left, value on the right; for detail lists.
class InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final Widget? valueWidget;
  const InfoRow(this.label, this.value, {super.key, this.valueWidget});

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(
          width: 118,
          child: Text(label, style: TextStyle(color: c.muted, fontSize: 14)),
        ),
        Expanded(
          child: valueWidget ?? Text(value, style: TextStyle(color: c.text, fontSize: 14.5)),
        ),
      ]),
    );
  }
}

/// Tinted note for guidance, warnings and errors.
enum CalloutKind { info, warn, danger, success }

class Callout extends StatelessWidget {
  final String? title;
  final String message;
  final CalloutKind kind;
  final IconData? icon;
  const Callout(this.message, {super.key, this.title, this.kind = CalloutKind.info, this.icon});

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final (bg, fg, defIcon) = switch (kind) {
      CalloutKind.info => (c.surface2, c.muted, Icons.info_outline),
      CalloutKind.warn => (c.warnSoft, c.warn, Icons.schedule),
      CalloutKind.danger => (c.dangerSoft, c.danger, Icons.error_outline),
      CalloutKind.success => (c.greenSoft, c.green, Icons.check_circle_outline),
    };
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(8),
        border: kind == CalloutKind.info ? Border.all(color: c.border) : null,
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon ?? defIcon, size: 19, color: fg),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (title != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Text(title!, style: TextStyle(fontWeight: FontWeight.w600, color: c.text, fontSize: 14.5)),
              ),
            Text(message, style: TextStyle(color: c.text2, fontSize: 14, height: 1.4)),
          ]),
        ),
      ]),
    );
  }
}

/// One row of filter chips with counts. Options with nothing in them are
/// hidden (except the selected one), so the row only shows real choices.
class FilterOption<T> {
  final T value;
  final String label;
  final int count;
  final bool alert;
  const FilterOption(this.value, this.label, this.count, {this.alert = false});
}

class FilterBar<T> extends StatelessWidget {
  final List<FilterOption<T>> options;
  final T selected;
  final ValueChanged<T> onSelected;
  const FilterBar({super.key, required this.options, required this.selected, required this.onSelected});

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final shown = [
      for (var i = 0; i < options.length; i++)
        if (i == 0 || options[i].count > 0 || options[i].value == selected) options[i],
    ];
    return SizedBox(
      height: 42,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          for (final o in shown)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                selected: o.value == selected,
                onSelected: (_) => onSelected(o.value),
                side: BorderSide(color: o.value == selected ? c.green : c.borderStrong),
                label: Text.rich(TextSpan(children: [
                  TextSpan(
                    text: o.label,
                    style: TextStyle(
                      color: o.value == selected ? c.green : c.text2,
                      fontWeight: o.value == selected ? FontWeight.w600 : FontWeight.w500,
                    ),
                  ),
                  TextSpan(
                    text: '  ${o.count}',
                    style: TextStyle(
                      color: o.alert && o.count > 0 ? c.danger : c.muted,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ])),
              ),
            ),
        ],
      ),
    );
  }
}

/// Secondary details joined by a middle dot, in muted text.
class MetaLine extends StatelessWidget {
  final List<InlineSpan> parts;
  const MetaLine(this.parts, {super.key});

  @override
  Widget build(BuildContext context) {
    final spans = <InlineSpan>[];
    for (var i = 0; i < parts.length; i++) {
      if (i > 0) spans.add(const TextSpan(text: '  ·  '));
      spans.add(parts[i]);
    }
    return Text.rich(
      TextSpan(children: spans),
      style: TextStyle(fontSize: 13.5, color: context.c.muted),
    );
  }
}

/// Centered message with an optional action, for empty and error states.
class MessageView extends StatelessWidget {
  final IconData icon;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;
  const MessageView({
    super.key,
    required this.icon,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(color: c.hover, shape: BoxShape.circle),
            child: Icon(icon, size: 30, color: c.muted),
          ),
          const SizedBox(height: 16),
          Text(message,
              textAlign: TextAlign.center,
              style: TextStyle(color: c.text2, fontSize: 15, height: 1.45)),
          if (actionLabel != null) ...[
            const SizedBox(height: 18),
            FilledButton(onPressed: onAction, child: Text(actionLabel!)),
          ],
        ]),
      ),
    );
  }
}
