import 'dart:async';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/api_client.dart';
import '../../core/config.dart';
import '../../core/format.dart';
import '../../core/realtime.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import 'job_order_form_screen.dart';

const formStatusLabel = {
  'SUBMITTED': 'Sent',
  'RECEIVED': 'Received by GSO',
  'APPROVED': 'Approved',
  'RETURNED': 'Needs changes',
};

// fixed hues; Pill lightens them on the dark theme
Color formStatusColor(String s) {
  switch (s) {
    case 'APPROVED':
      return const Color(0xFF2E9A55);
    case 'RETURNED':
      return const Color(0xFFD0453A);
    case 'RECEIVED':
      return const Color(0xFFC98512);
    default:
      return const Color(0xFF3B6FD0);
  }
}

/// A submitted Job Order Form: details, signature, progress and the PDF.
class FormDetailScreen extends StatefulWidget {
  final String formId;
  const FormDetailScreen({super.key, required this.formId});

  @override
  State<FormDetailScreen> createState() => _FormDetailScreenState();
}

class _FormDetailScreenState extends State<FormDetailScreen> {
  Map<String, dynamic>? form;
  bool loading = true;
  bool opening = false;
  String? error;
  StreamSubscription<Map<String, dynamic>>? _sub;

  @override
  void initState() {
    super.initState();
    load();
    _sub = Realtime.instance.events.listen((e) {
      if (mounted && e['kind'] == 'form.updated' && e['reportId'] == form?['reportId']) load(silent: true);
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> load({bool silent = false}) async {
    if (!silent) setState(() => loading = true);
    try {
      final res = await ApiClient.instance.dio.get('/job-order-forms/${widget.formId}');
      form = Map<String, dynamic>.from(res.data);
      error = null;
    } catch (e) {
      if (!silent) error = errorMessage(e);
    }
    if (mounted) setState(() => loading = false);
  }

  // asks the server for a 5-minute link and opens it in the phone's
  // browser or PDF viewer, where it can be saved or printed
  Future<void> openPdf() async {
    setState(() => opening = true);
    try {
      final res = await ApiClient.instance.dio.post('/job-order-forms/${widget.formId}/pdf-link');
      final url = Uri.parse('${AppConfig.baseUrl}${res.data['path']}');
      final ok = await launchUrl(url, mode: LaunchMode.externalApplication);
      if (!ok && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('No app could open the PDF on this phone.')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(e))));
      }
    }
    if (mounted) setState(() => opening = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(form?['formNo'] ?? 'Job Order Form')),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? MessageView(icon: Icons.cloud_off, message: error!, actionLabel: 'Retry', onAction: load)
              : ReadableWidth(child: _content()),
    );
  }

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 120, child: Text(label, style: TextStyle(color: context.c.muted))),
          Expanded(child: Text(value)),
        ]),
      );

  Widget _content() {
    final f = form!;
    final status = f['status'] as String;
    final job = f['report']?['jobOrder'];
    final sig = f['signatureUrl'] as String?;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(children: [
          Expanded(
            child: Text(f['categoryName'], style: Theme.of(context).textTheme.titleLarge),
          ),
          Pill(formStatusLabel[status] ?? status, formStatusColor(status)),
        ]),
        if (status == 'RETURNED') ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.red.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              const Text('The GSO asked for changes:', style: TextStyle(fontWeight: FontWeight.w700)),
              Text(f['decisionNote'] ?? ''),
              const SizedBox(height: 8),
              FilledButton(
                onPressed: () async {
                  final done = await Navigator.push<bool>(
                    context,
                    MaterialPageRoute(builder: (_) => JobOrderFormScreen(reportId: f['reportId'])),
                  );
                  if (done == true) load();
                },
                child: Text('Edit and re-sign'),
              ),
            ]),
          ),
        ],
        const Divider(height: 32),
        _row('Department', f['department']),
        _row('Contact', f['contactNumber']),
        _row('Location', f['locationText']),
        _row('Priority', urgencyLabel(f['urgency'])),
        _row('Schedule', f['preferredSchedule'] ?? 'Any time'),
        _row('Work requested', f['workRequested']),
        if (f['notes'] != null) _row('Notes', f['notes']),
        const Divider(height: 32),
        Text('Progress', style: Theme.of(context).textTheme.titleMedium),
        _row('Sent', formatDate(f['submittedAt'])),
        _row('Received', f['receivedAt'] != null ? formatDate(f['receivedAt']) : 'Not yet'),
        if (f['decidedAt'] != null)
          _row(status == 'APPROVED' ? 'Approved' : 'Returned', formatDate(f['decidedAt'])),
        if (status == 'APPROVED' && f['decisionNote'] != null) _row('Remarks', f['decisionNote']),
        _row('Job order', job != null && job['status'] != 'CANCELLED' ? job['jobOrderNo'] : 'Not yet issued'),
        const Divider(height: 32),
        Text('Your signature', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        if (sig != null)
          Container(
            height: 110,
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border.all(color: context.c.border),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Image.network(sig, fit: BoxFit.contain,
                errorBuilder: (_, _, _) => Center(child: Text('Signature could not be loaded'))),
          ),
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text(
            'Signed ${formatDate(f['signedAt'])}'
            '${f['integrityOk'] == true ? ' · unchanged since signing' : ' · CHANGED after signing'}',
            style: TextStyle(fontSize: 12, color: f['integrityOk'] == true ? context.c.muted : context.c.danger),
          ),
        ),
        const SizedBox(height: 20),
        OutlinedButton.icon(
          onPressed: opening ? null : openPdf,
          icon: opening
              ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.picture_as_pdf),
          label: const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Text('Download / print PDF'),
          ),
        ),
      ],
    );
  }
}
