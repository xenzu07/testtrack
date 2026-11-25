import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import '../../core/config.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';

/// True when [job] was offered to this technician and still needs an answer.
bool awaitingMyAnswer(Map job) =>
    job['status'] == 'ASSIGNED' && job['assignmentStatus'] == 'PENDING';

/// Shows a new assignment with its details and Accept / Decline actions.
/// Returns true when the technician answered (the job list should reload).
Future<bool> showAssignmentSheet(BuildContext context, Map<String, dynamic> job) async {
  final answered = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (_) => _AssignmentSheet(job: job),
  );
  return answered == true;
}

class _AssignmentSheet extends StatefulWidget {
  final Map<String, dynamic> job;
  const _AssignmentSheet({required this.job});

  @override
  State<_AssignmentSheet> createState() => _AssignmentSheetState();
}

class _AssignmentSheetState extends State<_AssignmentSheet> {
  bool declining = false;
  bool busy = false;
  String? error;
  final reason = TextEditingController();

  @override
  void dispose() {
    reason.dispose();
    super.dispose();
  }

  Future<void> send(bool accept) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final id = widget.job['id'];
      if (accept) {
        await ApiClient.instance.dio.post('/job-orders/$id/accept');
      } else {
        await ApiClient.instance.dio
            .post('/job-orders/$id/decline', data: {'reason': reason.text.trim()});
      }
      if (!mounted) return;
      Navigator.pop(context, true);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(accept
            ? 'Job accepted. You can start work when ready.'
            : 'Job declined. The coordinator has been told.'),
      ));
    } catch (e) {
      if (!mounted) return;
      final msg = errorMessage(e);
      // already answered elsewhere, or reassigned: close and refresh
      final stale = msg.contains('already') || msg.contains('no longer');
      if (stale) {
        Navigator.pop(context, true);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
        return;
      }
      setState(() {
        busy = false;
        error = msg;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final j = widget.job;
    final r = j['report'];
    final loc = r['location'];
    final photos = r['photos'] as List? ?? const [];
    final photo = photos.isEmpty ? null : AppConfig.mediaUrl(photos.first['storageUrl']);
    final reasonOk = reason.text.trim().length >= 5;

    Widget row(IconData icon, String text) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(icon, size: 18, color: context.c.muted),
            const SizedBox(width: 8),
            Expanded(child: Text(text)),
          ]),
        );

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: ReadableWidth(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('New job assigned to you',
                  style: Theme.of(context).textTheme.labelLarge?.copyWith(color: context.c.muted)),
              SizedBox(height: 4),
              Text(r['category']['name'],
                  style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 4, children: [
                PriorityPill(r['priority'] as String?),
                Pill(j['jobOrderNo'], context.c.muted, icon: Icons.receipt_long),
                if (isOverdue(j)) Pill('Overdue', context.c.danger, icon: Icons.warning_amber),
              ]),
              SizedBox(height: 12),
              if (photo != null)
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Image.network(photo,
                      height: 160,
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => const SizedBox.shrink()),
                ),
              const SizedBox(height: 8),
              Text(r['description']),
              const SizedBox(height: 8),
              row(Icons.place, '${loc['building']}, ${loc['floor']}, ${loc['room']}'),
              row(Icons.event, 'Target date: ${formatDay(j['targetDate'])}'),
              row(Icons.inventory_2, 'Materials: ${j['materialsNote'] ?? 'not specified'}'),
              row(Icons.person, 'Reported by ${r['reporter']['fullName']}'),
              const SizedBox(height: 16),
              if (!declining) ...[
                FilledButton.icon(
                  onPressed: busy ? null : () => send(true),
                  icon: busy
                      ? const SizedBox(
                          height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.check),
                  label: const Padding(
                      padding: EdgeInsets.symmetric(vertical: 12), child: Text('Accept job')),
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: busy ? null : () => setState(() => declining = true),
                  icon: const Icon(Icons.close),
                  label: const Padding(
                      padding: EdgeInsets.symmetric(vertical: 12), child: Text('Decline')),
                ),
                TextButton(
                  onPressed: busy ? null : () => Navigator.pop(context, false),
                  child: const Text('Decide later'),
                ),
              ] else ...[
                const Text('Why can you not take this job?',
                    style: TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                TextField(
                  controller: reason,
                  autofocus: true,
                  maxLines: 3,
                  maxLength: 500,
                  enabled: !busy,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    hintText: 'Example: On leave until Friday / Need an electrician for this',
                    helperText: 'Required. Only the coordinator sees this.',
                  ),
                ),
                const SizedBox(height: 8),
                FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: context.c.danger),
                  onPressed: busy || !reasonOk ? null : () => send(false),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: busy
                        ? SizedBox(
                            height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Decline job'),
                  ),
                ),
                TextButton(
                  onPressed: busy ? null : () => setState(() => declining = false),
                  child: const Text('Back'),
                ),
              ],
              if (error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(error!, style: TextStyle(color: context.c.danger)),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
