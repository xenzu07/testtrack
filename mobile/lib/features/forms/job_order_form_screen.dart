import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import 'signature_pad.dart';

/// The reporter's Job Order Form for one report: pre-filled from the account
/// and the report, validated, signed on screen, then sent to the GSO.
/// Also used to correct and re-sign a form the coordinator returned.
class JobOrderFormScreen extends StatefulWidget {
  final String reportId;
  const JobOrderFormScreen({super.key, required this.reportId});

  @override
  State<JobOrderFormScreen> createState() => _JobOrderFormScreenState();
}

class _JobOrderFormScreenState extends State<JobOrderFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final department = TextEditingController();
  final contact = TextEditingController();
  final work = TextEditingController();
  final schedule = TextEditingController();
  final notes = TextEditingController();
  final signature = SignatureController();

  Map<String, dynamic>? data;
  bool loading = true;
  bool submitting = false;
  bool signing = false;
  bool certified = false;
  bool triedSubmit = false;
  String? error;

  @override
  void initState() {
    super.initState();
    signature.addListener(() => setState(() {}));
    load();
  }

  @override
  void dispose() {
    for (final c in [department, contact, work, schedule, notes]) {
      c.dispose();
    }
    signature.dispose();
    super.dispose();
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final res = await ApiClient.instance.dio.get('/job-order-forms/prefill/${widget.reportId}');
      final d = Map<String, dynamic>.from(res.data);
      final existing = d['existingForm'];
      final remembered = d['remembered'];
      // a returned form starts from what was sent; a new one from the report
      department.text = existing?['department'] ?? remembered?['department'] ?? '';
      contact.text = existing?['contactNumber'] ?? remembered?['contactNumber'] ?? '';
      work.text = existing?['workRequested'] ?? d['report']['description'] ?? '';
      schedule.text = existing?['preferredSchedule'] ?? '';
      notes.text = existing?['notes'] ?? '';
      data = d;
    } catch (e) {
      error = errorMessage(e);
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> submit() async {
    setState(() => triedSubmit = true);
    final fieldsOk = _formKey.currentState?.validate() ?? false;
    if (!fieldsOk || !certified || !signature.isUsable) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Please complete the highlighted parts of the form.')));
      return;
    }
    setState(() => submitting = true);
    try {
      final png = await signature.toPng();
      if (png == null) throw Exception('signature');
      final form = FormData.fromMap({
        'reportId': widget.reportId,
        'department': department.text.trim(),
        'contactNumber': contact.text.trim(),
        'workRequested': work.text.trim(),
        'preferredSchedule': schedule.text.trim(),
        'notes': notes.text.trim(),
        'certified': 'true',
        'signature': MultipartFile.fromBytes(png,
            filename: 'signature.png', contentType: DioMediaType.parse('image/png')),
      });
      final res = await ApiClient.instance.dio.post('/job-order-forms', data: form);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('Job Order Form ${res.data['formNo']} sent to the GSO.')));
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      setState(() => submitting = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(errorMessage(e))));
    }
  }

  InputDecoration _dec(String label, {String? hint, String? helper}) => InputDecoration(
        labelText: label,
        hintText: hint,
        helperText: helper,
        border: const OutlineInputBorder(),
      );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Job Order Form')),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? MessageView(icon: Icons.cloud_off, message: error!, actionLabel: 'Retry', onAction: load)
              : ReadableWidth(child: _form()),
    );
  }

  Widget _readOnly(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 110, child: Text(label, style: TextStyle(color: context.c.muted))),
          Expanded(child: Text(value)),
        ]),
      );

  Widget _form() {
    final d = data!;
    final req = d['requester'] ?? {};
    final rep = d['report'];
    final existing = d['existingForm'];
    final returned = existing != null && existing['status'] == 'RETURNED';

    if (d['canSubmit'] != true) {
      return MessageView(
        icon: Icons.assignment_turned_in,
        message: existing != null
            ? 'A Job Order Form (${existing['formNo']}) was already sent for this report.'
            : 'This report is closed; a Job Order Form is no longer needed.',
      );
    }

    return Form(
      key: _formKey,
      autovalidateMode: triedSubmit ? AutovalidateMode.onUserInteraction : AutovalidateMode.disabled,
      child: ListView(
        physics: signing ? const NeverScrollableScrollPhysics() : null,
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          if (returned)
            Container(
              padding: const EdgeInsets.all(12),
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: Colors.red.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: context.c.danger),
              ),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('The GSO returned ${existing['formNo']} for changes',
                    style: TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: 4),
                Text(existing['decisionNote'] ?? ''),
                const SizedBox(height: 4),
                Text('Correct the form below and sign it again.',
                    style: TextStyle(color: context.c.muted)),
              ]),
            ),
          Text('Requesting party', style: Theme.of(context).textTheme.titleMedium),
          SizedBox(height: 4),
          _readOnly('Name', req['fullName'] ?? ''),
          _readOnly('Email', req['email'] ?? ''),
          _readOnly('Position', req['userType'] ?? 'Not specified'),
          const SizedBox(height: 12),
          TextFormField(
            controller: department,
            enabled: !submitting,
            textCapitalization: TextCapitalization.words,
            maxLength: 120,
            decoration: _dec('Department or office *', hint: 'Example: College of Engineering, BSIT 3-1'),
            validator: (v) => (v ?? '').trim().length < 2 ? 'Department or office is required' : null,
          ),
          const SizedBox(height: 8),
          TextFormField(
            controller: contact,
            enabled: !submitting,
            keyboardType: TextInputType.phone,
            decoration: _dec('Contact number *', hint: '0917 123 4567'),
            validator: (v) => RegExp(r'^\+?[\d\s()-]{7,20}$').hasMatch((v ?? '').trim())
                ? null
                : 'Enter a valid contact number',
          ),
          const Divider(height: 32),
          Text('Work requested', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          _readOnly('Category', rep['category']),
          _readOnly('Location', rep['location']),
          _readOnly('Urgency', urgencyLabel(rep['urgency'])),
          const SizedBox(height: 12),
          TextFormField(
            controller: work,
            enabled: !submitting,
            maxLines: 4,
            maxLength: 2000,
            decoration: _dec('Description of the work *', helper: 'Pre-filled from your report. Edit if needed.'),
            validator: (v) => (v ?? '').trim().length < 10
                ? 'Describe the work requested (at least 10 characters)'
                : null,
          ),
          const SizedBox(height: 8),
          TextFormField(
            controller: schedule,
            enabled: !submitting,
            maxLength: 200,
            decoration: _dec('Preferred schedule (optional)', hint: 'Example: after 3 PM, or Saturday morning'),
          ),
          const SizedBox(height: 8),
          TextFormField(
            controller: notes,
            enabled: !submitting,
            maxLines: 2,
            maxLength: 1000,
            decoration: _dec('Additional notes (optional)'),
          ),
          const Divider(height: 32),
          Text('Certification and signature', style: Theme.of(context).textTheme.titleMedium),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: certified,
            onChanged: submitting ? null : (v) => setState(() => certified = v ?? false),
            title: const Text(
                'I certify that the information in this request is true and correct, and I request '
                'the General Services Office to carry out the work described.'),
            subtitle: triedSubmit && !certified
                ? Text('Required', style: TextStyle(color: context.c.danger))
                : null,
          ),
          SizedBox(height: 8),
          SignaturePad(
            controller: signature,
            enabled: !submitting,
            onSigning: (v) => setState(() => signing = v),
          ),
          Row(children: [
            Expanded(
              child: Text(
                triedSubmit && !signature.isUsable
                    ? 'Please sign in the box above'
                    : 'Sign with your finger. Your signature is stored privately.',
                style: TextStyle(
                    fontSize: 12,
                    color: triedSubmit && !signature.isUsable ? context.c.danger : context.c.muted),
              ),
            ),
            TextButton.icon(
              onPressed: submitting || signature.isEmpty ? null : signature.clear,
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('Clear'),
            ),
          ]),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: submitting ? null : submit,
            icon: submitting
                ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.send),
            label: Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(returned ? 'Re-sign and resubmit' : 'Sign and send to GSO'),
            ),
          ),
        ],
      ),
    );
  }
}
