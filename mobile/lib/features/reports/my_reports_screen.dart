import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/realtime.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import '../auth/account_menu.dart';
import '../notifications/notifications.dart';
import 'create_report_screen.dart';
import 'report_detail_screen.dart';
import '../forms/form_detail_screen.dart';

enum _Filter { all, open, toRate, done }

class MyReportsScreen extends StatefulWidget {
  const MyReportsScreen({super.key});

  @override
  State<MyReportsScreen> createState() => _MyReportsScreenState();
}

class _MyReportsScreenState extends State<MyReportsScreen> {
  List<dynamic> reports = [];
  bool loading = true;
  String? error;
  _Filter filter = _Filter.all;
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
      final res = await ApiClient.instance.dio.get('/reports/mine');
      final list = List<dynamic>.from(res.data as List);
      // most recently updated first, so news is at the top
      list.sort((a, b) => lastActivity(b).compareTo(lastActivity(a)));
      reports = list;
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

  bool _needsRating(dynamic r) => r['status'] == 'CLOSED' && r['feedback'] == null;

  List<dynamic> get shown {
    switch (filter) {
      case _Filter.open:
        return reports.where((r) => isOpenReport(r['status'])).toList();
      case _Filter.toRate:
        return reports.where(_needsRating).toList();
      case _Filter.done:
        return reports.where((r) => !isOpenReport(r['status'])).toList();
      case _Filter.all:
        return reports;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const BrandTitle('My Reports'),
        toolbarHeight: 64,
        actions: [
          const NotificationBell(),
          const ThemeToggleButton(),
          const AccountMenuButton(),
          const SizedBox(width: 4),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: openNewReport,
        icon: const Icon(Icons.add_a_photo),
        label: const Text('New report'),
      ),
      body: _body(),
    );
  }

  Widget _body() {
    if (loading) return const Center(child: CircularProgressIndicator());
    if (error != null) {
      return MessageView(
          icon: Icons.cloud_off,
          message: error!,
          actionLabel: 'Retry',
          onAction: load);
    }
    if (reports.isEmpty) {
      return const MessageView(
        icon: Icons.assignment_outlined,
        message:
            'No reports yet.\nSpotted something broken on campus? Tap "New report" to send it with a photo.',
      );
    }

    final open = reports.where((r) => isOpenReport(r['status'])).length;
    final toRate = reports.where(_needsRating).length;
    final done = reports.length - open;
    final list = shown;

    return RefreshIndicator(
      onRefresh: load,
      child: ReadableWidth(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
          children: [
            FilterBar<_Filter>(
              selected: filter,
              onSelected: (f) => setState(() => filter = f),
              options: [
                FilterOption(_Filter.all, 'All', reports.length),
                FilterOption(_Filter.open, 'Being handled', open),
                FilterOption(_Filter.toRate, 'To rate', toRate, alert: true),
                FilterOption(_Filter.done, 'Done', done),
              ],
            ),
            SizedBox(height: 8),
            if (list.isEmpty)
              const EmptyState(
                icon: Icons.inbox_outlined,
                title: 'Nothing here',
                message: 'No reports match this filter.',
              ),
            ...list.map((r) => _ReportCard(
                  report: Map<String, dynamic>.from(r),
                  needsRating: _needsRating(r),
                  onTap: () async {
                    await Navigator.push(
                      context,
                      MaterialPageRoute(
                          builder: (_) => ReportDetailScreen(reportId: r['id'])),
                    );
                    load(silent: true);
                  },
                )),
          ],
        ),
      ),
    );
  }
}

class _ReportCard extends StatelessWidget {
  final Map<String, dynamic> report;
  final bool needsRating;
  final VoidCallback onTap;
  const _ReportCard(
      {required this.report, required this.needsRating, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final r = report;
    final loc = r['location'];
    final job = r['jobOrder'];
    final status = r['status'] as String;
    final step = progressIndex(status);
    final tech = job?['technician']?['fullName'] as String?;

    final form = r['jobOrderForm'];
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(
                  child: Text(r['category']['name'],
                      style: Theme.of(context).textTheme.titleMedium),
                ),
                SizedBox(width: 8),
                StatusChip(status),
              ]),
              const SizedBox(height: 2),
              Text('${loc['building']}, ${loc['floor']}, ${loc['room']}',
                  style: const TextStyle(fontSize: 13)),
              const SizedBox(height: 10),
              ClipRRect(
                borderRadius: BorderRadius.circular(2),
                child: LinearProgressIndicator(
                  value: (step + 1) / 6,
                  minHeight: 3,
                  color: statusColor(status),
                  backgroundColor: context.c.hover,
                  semanticsLabel: 'Progress',
                  semanticsValue: statusLabel(status),
                ),
              ),
              SizedBox(height: 10),
              Row(children: [
                Expanded(
                  child: MetaLine([
                    if (job != null) TextSpan(text: job['jobOrderNo'] as String),
                    if (tech != null) TextSpan(text: tech),
                    if (form != null && job == null)
                      TextSpan(text: 'Form ${(formStatusLabel[form['status']] ?? '').toLowerCase()}'),
                    TextSpan(text: timeAgo(lastActivity(r))),
                  ]),
                ),
                if (needsRating) Pill('Rate repair', context.c.warn),
              ]),
            ],
          ),
        ),
      ),
    );
  }
}
