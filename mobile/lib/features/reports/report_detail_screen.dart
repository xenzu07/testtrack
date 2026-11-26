import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import '../../core/config.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import 'dart:async';
import '../../core/realtime.dart';
import 'feedback_section.dart';
import '../forms/form_detail_screen.dart';
import '../forms/job_order_form_screen.dart';

class ReportDetailScreen extends StatefulWidget {
  final String reportId;
  const ReportDetailScreen({super.key, required this.reportId});

  @override
  State<ReportDetailScreen> createState() => _ReportDetailScreenState();
}

class _ReportDetailScreenState extends State<ReportDetailScreen> {
  Map<String, dynamic>? report;
  bool loading = true;
  String? error;
  StreamSubscription<Map<String, dynamic>>? _sub;

  @override
  void initState() {
    super.initState();
    load();
    _sub = Realtime.instance.events.listen((e) {
      if (mounted && e['reportId'] == widget.reportId) load(silent: true);
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
      final res =
          await ApiClient.instance.dio.get('/reports/${widget.reportId}');
      report = Map<String, dynamic>.from(res.data);
      error = null;
    } catch (e) {
      if (!silent) error = errorMessage(e);
    }
    if (mounted) setState(() => loading = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Report')),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Text(error!, textAlign: TextAlign.center),
                      const SizedBox(height: 12),
                      FilledButton(onPressed: load, child: const Text('Retry')),
                    ]),
                  ),
                )
              : RefreshIndicator(onRefresh: load, child: ReadableWidth(child: _content())),
    );
  }

  // The reporter's Job Order Form for this report: fill it out, see its
  // progress, or correct it when the GSO returned it.
  Widget _formCard(Map<String, dynamic> r) {
    final f = r['jobOrderForm'];
    final closed = r['status'] == 'CLOSED';
    Future<void> openForm() async {
      final done = await Navigator.push<bool>(
        context,
        MaterialPageRoute(builder: (_) => JobOrderFormScreen(reportId: r['id'])),
      );
      if (done == true) load(silent: true);
    }

    Future<void> openDetail() async {
      await Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => FormDetailScreen(formId: f['id'])),
      );
      load(silent: true);
    }

    final c = context.c;
    return SectionCard(
      title: 'Job Order Form',
      trailing: f != null
          ? Pill(formStatusLabel[f['status']] ?? f['status'], formStatusColor(f['status']))
          : null,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (f == null)
          Text(
            closed
                ? 'Not needed: this report is closed.'
                : 'A signed request form for the GSO. Most details are filled in for you.',
            style: TextStyle(color: c.muted, fontSize: 14),
          )
        else ...[
          Text('${f['formNo']}  ·  sent ${formatDate(f['submittedAt'])}',
              style: TextStyle(color: c.muted, fontSize: 14)),
          if (f['status'] == 'RETURNED') ...[
            const SizedBox(height: 10),
            Callout(f['decisionNote'] ?? 'Please review the form and sign it again.',
                title: 'The GSO asked for changes', kind: CalloutKind.danger),
          ],
        ],
        const SizedBox(height: 14),
        if (f == null && !closed)
          FilledButton.icon(
            onPressed: openForm,
            icon: const Icon(Icons.edit_document),
            label: const Text('Fill out and sign'),
          )
        else if (f != null)
          Row(children: [
            Expanded(
              child: OutlinedButton(onPressed: openDetail, child: const Text('View form and PDF')),
            ),
            if (f['status'] == 'RETURNED') ...[
              const SizedBox(width: 8),
              Expanded(child: FilledButton(onPressed: openForm, child: const Text('Edit and re-sign'))),
            ],
          ]),
      ]),
    );
  }

  Widget _content() {
    final r = report!;
    final loc = r['location'];
    final photos = r['photos'] as List;
    final logs = r['logs'] as List;
    // a report linked to another report of the same problem is handled under
    // that report's job order
    final linked = r['duplicateOf'];
    final ownJob = r['jobOrder'];
    final job = linked != null && linked['jobOrder'] != null
        ? linked['jobOrder']
        : (ownJob != null && ownJob['status'] == 'CANCELLED' ? null : ownJob);

    final c = context.c;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
            child: Text(r['category']['name'], style: Theme.of(context).textTheme.titleLarge),
          ),
          const SizedBox(width: 12),
          Padding(padding: const EdgeInsets.only(top: 5), child: StatusChip(r['status'])),
        ]),
        const SizedBox(height: 4),
        Text('${loc['building']}, ${loc['floor']}, ${loc['room']}',
            style: TextStyle(color: c.muted, fontSize: 14.5)),
        const SizedBox(height: 16),
        SectionCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            ProgressSteps(r['status']),
            const SizedBox(height: 16),
            Callout(nextStepText(r['status'], hasFeedback: r['feedback'] != null)),
          ]),
        ),
        SectionCard(
          title: 'What you reported',
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (photos.isNotEmpty) ...[
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.network(
                  AppConfig.mediaUrl(photos.first['storageUrl']) ?? '',
                  height: 200,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => Container(
                    height: 200,
                    color: c.hover,
                    alignment: Alignment.center,
                    child: Text('Photo could not be loaded', style: TextStyle(color: c.muted)),
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],
            Text(r['description'], style: Theme.of(context).textTheme.bodyLarge),
          ]),
        ),
        SectionCard(
          title: 'Details',
          child: Column(children: [
            // set by the system from the answers (urgency and priority are one level)
            InfoRow('Priority', urgencyLabel(r['urgency'])),
            InfoRow('Trade unit', r['proposedTradeUnit']['name']),
            InfoRow('Submitted', formatDate(r['createdAt'])),
            if (linked != null) InfoRow('Handled with', 'Another report of the same problem'),
            if (job != null) ...[
              InfoRow('Job order', job['jobOrderNo']),
              InfoRow('Technician', job['technician']?['fullName'] ?? 'Not yet assigned'),
              InfoRow('Target date', formatDay(job['targetDate'])),
              InfoRow('Materials', job['materialsNote'] ?? 'Not specified'),
            ],
          ]),
        ),
        _formCard(r),
        if (r['status'] == 'CLOSED')
          SectionCard(
            child: FeedbackSection(
              reportId: r['id'] as String,
              feedback: r['feedback'] == null ? null : Map<String, dynamic>.from(r['feedback']),
              onSubmitted: () => load(silent: true),
            ),
          ),
        SectionCard(title: 'Status history', child: HistoryTimeline(logs)),
      ],
    );
  }
}
