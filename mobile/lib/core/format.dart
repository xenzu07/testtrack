import 'package:flutter/material.dart';
import 'config.dart';

String statusLabel(String s) => s
    .split('_')
    .map((w) => w[0] + w.substring(1).toLowerCase())
    .join(' ');

String urgencyLabel(String s) => s[0] + s.substring(1).toLowerCase();

Color statusColor(String s) {
  switch (s) {
    case 'SUBMITTED':
      return Colors.blueGrey;
    case 'UNDER_REVIEW':
      return Colors.orange;
    case 'ASSIGNED':
      return Colors.indigo;
    case 'IN_PROGRESS':
      return Colors.amber.shade800;
    case 'COMPLETED':
      return Colors.green;
    case 'DELAYED':
      return Colors.purple;
    case 'CLOSED':
      return Colors.blueGrey.shade700;
    default:
      return Colors.grey;
  }
}

String formatDate(String iso) {
  final d = DateTime.parse(iso).toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${d.year}-${two(d.month)}-${two(d.day)} ${two(d.hour)}:${two(d.minute)}';
}

class StatusChip extends StatelessWidget {
  final String status;
  const StatusChip(this.status, {super.key});

  @override
  Widget build(BuildContext context) {
    final color = statusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color),
      ),
      child: Text(
        statusLabel(status),
        style: TextStyle(color: color, fontWeight: FontWeight.w600, fontSize: 12),
      ),
    );
  }
}

// one entry of a report's status history, with progress updates and photos
class HistoryTile extends StatelessWidget {
  final Map<String, dynamic> log;
  const HistoryTile(this.log, {super.key});

  @override
  Widget build(BuildContext context) {
    final newStatus = log['newStatus'] as String;
    final isProgress =
        log['oldStatus'] == 'IN_PROGRESS' && newStatus == 'IN_PROGRESS';
    final remarks = log['remarks'] as String?;
    final photoUrl = log['photoUrl'] as String?;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 4, right: 12),
            child: Icon(Icons.circle, size: 14, color: statusColor(newStatus)),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(isProgress ? 'Progress update' : statusLabel(newStatus),
                    style: const TextStyle(fontWeight: FontWeight.w600)),
                if (remarks != null && remarks.isNotEmpty) Text(remarks),
                if (photoUrl != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: Image.network(
                        '${AppConfig.baseUrl}$photoUrl',
                        height: 140,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => Container(
                          height: 140,
                          color: Colors.black12,
                          alignment: Alignment.center,
                          child: const Text('Photo could not be loaded'),
                        ),
                      ),
                    ),
                  ),
                Text(formatDate(log['createdAt'] as String),
                    style: const TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}