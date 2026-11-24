import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/realtime.dart';
import '../auth/auth_provider.dart';
import 'create_report_screen.dart';
import 'report_detail_screen.dart';

enum ReportFilter { all, open, working, closed }

class MyReportsScreen extends StatefulWidget {
  const MyReportsScreen({super.key});

  @override
  State<MyReportsScreen> createState() => _MyReportsScreenState();
}

class _MyReportsScreenState extends State<MyReportsScreen> {
  List<dynamic> reports = [];
  bool loading = true;
  String? error;
  ReportFilter filter = ReportFilter.all;
  StreamSubscription<Map<String, dynamic>>? _sub;

  // waiting for review/assignment
  static const _openStatuses = {'SUBMITTED', 'UNDER_REVIEW', 'ASSIGNED'};
  // someone is on it
  static const _workingStatuses = {'IN_PROGRESS', 'DELAYED', 'COMPLETED'};

  @override
  void initState() {
    super.initState();
    load();
    _sub = Realtime.instance.events.listen((_) {
      if (mounted) load(silent: true);
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        loading = true;
        error = null;
      });
    }
    try {
      final res = await ApiClient.instance.dio.get('/reports/mine');
      reports = res.data as List;
      error = null;
    } catch (e) {
      if (!silent) error = errorMessage(e);
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> openNewReport() async {
    final created = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => const CreateReportScreen()),
    );
    if (created == true) load();
  }

  bool _matches(dynamic r) {
    final s = r['status'] as String;
    switch (filter) {
      case ReportFilter.all:
        return true;
      case ReportFilter.open:
        return _openStatuses.contains(s);
      case ReportFilter.working:
        return _workingStatuses.contains(s);
      case ReportFilter.closed:
        return s == 'CLOSED';
    }
  }

  // how far along a report is, for the little progress bar
  double _progress(String s) {
    switch (s) {
      case 'SUBMITTED':
        return 0.15;
      case 'UNDER_REVIEW':
        return 0.3;
      case 'ASSIGNED':
        return 0.5;
      case 'IN_PROGRESS':
      case 'DELAYED':
        return 0.7;
      case 'COMPLETED':
        return 0.9;
      case 'CLOSED':
        return 1.0;
      default:
        return 0;
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.read<AuthProvider>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('My Reports'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: load),
          IconButton(
              icon: const Icon(Icons.logout),
              tooltip: 'Sign out',
              onPressed: auth.logout),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: openNewReport,
        icon: const Icon(Icons.add_a_photo),
        label: const Text('New report'),
      ),
      body: _body(auth),
    );
  }

  Widget _body(AuthProvider auth) {
    if (loading) return const Center(child: CircularProgressIndicator());
    if (error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(error!, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton(onPressed: load, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }
    if (reports.isEmpty) {
      return const Center(
          child: Text('No reports yet. Tap "New report" to submit one.'));
    }

    final total = reports.length;
    final waiting = reports.where((r) => _openStatuses.contains(r['status'])).length;
    final working = reports.where((r) => _workingStatuses.contains(r['status'])).length;
    final resolved = reports.where((r) => r['status'] == 'CLOSED').length;
    // closed reports the user has not rated yet
    final toRate =
        reports.where((r) => r['status'] == 'CLOSED' && r['feedback'] == null).length;
    final shown = reports.where(_matches).toList();
    final firstName = (auth.user?.fullName ?? '').split(' ').first;

    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
        children: [
          Text('Hello, $firstName',
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          const Text('Track the repairs you reported.',
              style: TextStyle(color: Colors.grey)),
          const SizedBox(height: 12),
          Row(
            children: [
              _Stat('Total', total, Colors.blueGrey),
              const SizedBox(width: 8),
              _Stat('Waiting', waiting, Colors.orange),
              const SizedBox(width: 8),
              _Stat('Being fixed', working, Colors.indigo),
              const SizedBox(width: 8),
              _Stat('Resolved', resolved, Colors.green),
            ],
          ),
          if (toRate > 0) ...[
            const SizedBox(height: 10),
            Card(
              margin: EdgeInsets.zero,
              color: Colors.amber.shade50,
              child: ListTile(
                leading: Icon(Icons.star_rounded, color: Colors.amber.shade800),
                title: Text(
                    '$toRate repair${toRate == 1 ? '' : 's'} waiting for your rating'),
                subtitle: const Text('Tell us how the work went'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => setState(() => filter = ReportFilter.closed),
              ),
            ),
          ],
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            children: [
              for (final f in ReportFilter.values)
                ChoiceChip(
                  label: Text(const {
                    ReportFilter.all: 'All',
                    ReportFilter.open: 'Waiting',
                    ReportFilter.working: 'Being fixed',
                    ReportFilter.closed: 'Resolved',
                  }[f]!),
                  selected: filter == f,
                  onSelected: (_) => setState(() => filter = f),
                ),
            ],
          ),
          const SizedBox(height: 8),
          if (shown.isEmpty)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Center(child: Text('No reports in this view.')),
            ),
          for (final r in shown) _reportCard(r),
        ],
      ),
    );
  }

  Widget _reportCard(dynamic r) {
    final loc = r['location'];
    final needsRating = r['status'] == 'CLOSED' && r['feedback'] == null;
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () async {
          await Navigator.push(
            context,
            MaterialPageRoute(
                builder: (_) => ReportDetailScreen(reportId: r['id'])),
          );
          load(silent: true);
        },
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(r['description'],
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                  ),
                  const SizedBox(width: 8),
                  StatusChip(r['status']),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                '${r['category']['name']}\n'
                '${loc['building']}, ${loc['floor']}, ${loc['room']}\n'
                '${formatDate(r['createdAt'])}',
                style: const TextStyle(color: Colors.grey, fontSize: 13),
              ),
              const SizedBox(height: 10),
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: LinearProgressIndicator(
                  value: _progress(r['status']),
                  minHeight: 6,
                  color: statusColor(r['status']),
                  backgroundColor: statusColor(r['status']).withValues(alpha: 0.15),
                ),
              ),
              if (needsRating)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Row(children: [
                    Icon(Icons.star_rounded, size: 18, color: Colors.amber.shade800),
                    const SizedBox(width: 4),
                    const Text('Tap to rate this repair',
                        style: TextStyle(fontSize: 13)),
                  ]),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  final String label;
  final int value;
  final Color color;
  const _Stat(this.label, this.value, this.color);

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withValues(alpha: 0.4)),
        ),
        child: Column(
          children: [
            Text('$value',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: color)),
            Text(label, style: const TextStyle(fontSize: 11)),
          ],
        ),
      ),
    );
  }
}