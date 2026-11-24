import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/charts.dart';
import '../../core/format.dart';
import '../../core/realtime.dart';
import '../auth/auth_provider.dart';
import 'job_detail_screen.dart';
import 'performance_screen.dart';

enum JobFilter { all, active, delayed, done }

class MyJobsScreen extends StatefulWidget {
  const MyJobsScreen({super.key});

  @override
  State<MyJobsScreen> createState() => _MyJobsScreenState();
}

class _MyJobsScreenState extends State<MyJobsScreen> {
  List<dynamic> jobs = [];
  bool loading = true;
  String? error;
  JobFilter filter = JobFilter.active;
  StreamSubscription<Map<String, dynamic>>? _sub;

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
      final res = await ApiClient.instance.dio.get('/job-orders/assigned');
      final list = List<dynamic>.from(res.data as List);
      // most urgent work first: status group, then urgency
      const order = {
        'IN_PROGRESS': 0,
        'ASSIGNED': 1,
        'DELAYED': 2,
        'COMPLETED': 3,
        'CLOSED': 4,
      };
      const urgency = {'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3};
      list.sort((a, b) {
        final byStatus =
            (order[a['status']] ?? 9).compareTo(order[b['status']] ?? 9);
        if (byStatus != 0) return byStatus;
        return (urgency[a['report']['urgency']] ?? 9)
            .compareTo(urgency[b['report']['urgency']] ?? 9);
      });
      jobs = list;
      error = null;
    } catch (e) {
      if (!silent) error = errorMessage(e);
    }
    if (mounted) setState(() => loading = false);
  }

  bool _isDone(dynamic j) => j['status'] == 'COMPLETED' || j['status'] == 'CLOSED';

  // target dates are stored as UTC midnight; a job is overdue after that day ends
  bool _isOverdue(dynamic j) {
    final t = j['targetDate'] as String?;
    if (t == null || _isDone(j)) return false;
    return DateTime.parse(t).toUtc().add(const Duration(days: 1)).isBefore(DateTime.now().toUtc());
  }

  bool _matches(dynamic j) {
    switch (filter) {
      case JobFilter.all:
        return true;
      case JobFilter.active:
        return j['status'] == 'ASSIGNED' || j['status'] == 'IN_PROGRESS';
      case JobFilter.delayed:
        return j['status'] == 'DELAYED';
      case JobFilter.done:
        return _isDone(j);
    }
  }

  Future<void> _open(Widget screen) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => screen));
    load(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.read<AuthProvider>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('My Jobs'),
        actions: [
          IconButton(
            icon: const Icon(Icons.insights),
            tooltip: 'My performance',
            onPressed: () => _open(const PerformanceScreen()),
          ),
          IconButton(icon: const Icon(Icons.refresh), onPressed: load),
          IconButton(
              icon: const Icon(Icons.logout),
              tooltip: 'Sign out',
              onPressed: auth.logout),
        ],
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

    final active =
        jobs.where((j) => j['status'] == 'ASSIGNED' || j['status'] == 'IN_PROGRESS').length;
    final delayed = jobs.where((j) => j['status'] == 'DELAYED').length;
    final overdue = jobs.where(_isOverdue).length;
    final done = jobs.where(_isDone).length;
    final shown = jobs.where(_matches).toList();
    final firstName = (auth.user?.fullName ?? '').split(' ').first;

    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          Text('Hello, $firstName',
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          Text(
            active == 0
                ? 'No active jobs right now.'
                : '$active active job${active == 1 ? '' : 's'} to work on.',
            style: const TextStyle(color: Colors.grey),
          ),
          const SizedBox(height: 12),
          GridView.count(
            crossAxisCount: 4,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 8,
            crossAxisSpacing: 8,
            childAspectRatio: 0.95,
            children: [
              _CountTile('Active', active, Colors.indigo),
              _CountTile('Delayed', delayed, Colors.purple),
              _CountTile('Overdue', overdue, Colors.red),
              _CountTile('Done', done, Colors.green),
            ],
          ),
          const SizedBox(height: 10),
          Card(
            margin: EdgeInsets.zero,
            child: ListTile(
              leading: const Icon(Icons.insights),
              title: const Text('My performance'),
              subtitle: const Text('Completion time, on-time rate, ratings'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _open(const PerformanceScreen()),
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            children: [
              for (final f in JobFilter.values)
                ChoiceChip(
                  label: Text(const {
                    JobFilter.all: 'All',
                    JobFilter.active: 'Active',
                    JobFilter.delayed: 'Delayed',
                    JobFilter.done: 'Done',
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
              child: Center(child: Text('No jobs in this view.')),
            ),
          for (final j in shown) _jobCard(j),
        ],
      ),
    );
  }

  Widget _jobCard(dynamic j) {
    final r = j['report'];
    final loc = r['location'];
    final overdue = _isOverdue(j);
    final target = j['targetDate'] as String?;
    return Card(
      child: ListTile(
        onTap: () => _open(JobDetailScreen(jobId: j['id'])),
        title: Text('${j['jobOrderNo']}  ·  ${r['category']['name']}',
            style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${loc['building']}, ${loc['floor']}, ${loc['room']}'),
              Text('Urgency: ${urgencyLabel(r['urgency'])}'),
              if (target != null)
                Text(
                  overdue
                      ? 'Overdue - target ${target.substring(0, 10)}'
                      : 'Target: ${target.substring(0, 10)}',
                  style: TextStyle(
                    color: overdue ? Colors.red : Colors.grey,
                    fontWeight: overdue ? FontWeight.w600 : FontWeight.w400,
                  ),
                ),
            ],
          ),
        ),
        isThreeLine: true,
        trailing: StatusChip(j['status']),
      ),
    );
  }
}

class _CountTile extends StatelessWidget {
  final String label;
  final int value;
  final Color color;
  const _CountTile(this.label, this.value, this.color);

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text('$value',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: color)),
          Text(label, style: const TextStyle(fontSize: 11)),
        ],
      ),
    );
  }
}