import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/api_client.dart';
import '../../core/config.dart';
import '../../core/realtime.dart';
import '../forms/signature_pad.dart';
import '../tech/v2.dart';
import 'rep_common.dart';

const scheduleChoices = ['Any time', 'Mornings', 'Afternoons', 'Weekends'];

/// What the reporter fills in on the Job Order Form.
class FormDraft {
  final department = TextEditingController();
  final contact = TextEditingController();
  final work = TextEditingController();
  final signature = SignatureController();
  String? schedule;
  String notes = '';
  bool certified = false;
  bool tried = false;

  bool get departmentOk => department.text.trim().length >= 2;
  bool get contactOk => RegExp(r'^\+?[\d\s()-]{7,20}$').hasMatch(contact.text.trim());
  bool get workOk => work.text.trim().length >= 10;
  bool get ok => departmentOk && contactOk && workOk && certified && signature.isUsable;

  void dispose() {
    department.dispose();
    contact.dispose();
    work.dispose();
    signature.dispose();
  }

  /// Signs and sends the form for [reportId]; returns the form number.
  Future<String> send(String reportId) async {
    final png = await signature.toPng();
    if (png == null) throw Exception('Please sign in the box.');
    final res = await ApiClient.instance.dio.post('/job-order-forms',
        data: FormData.fromMap({
          'reportId': reportId,
          'department': department.text.trim(),
          'contactNumber': contact.text.trim(),
          'workRequested': work.text.trim(),
          if (schedule != null) 'preferredSchedule': schedule,
          'notes': notes,
          'certified': 'true',
          'signature': MultipartFile.fromBytes(png,
              filename: 'signature.png', contentType: DioMediaType.parse('image/png')),
        }));
    return res.data['formNo'] as String;
  }
}

/// Department, contact, best time, signature and the certify box, as in the
/// design. [showWork] adds the work description when it can't be taken from
/// the report as is.
class FormFields extends StatelessWidget {
  final FormDraft d;
  final VoidCallback onChanged;
  final ValueChanged<bool> onSigning;
  final String? name;
  final bool showWork;
  final bool enabled;
  const FormFields({
    super.key,
    required this.d,
    required this.onChanged,
    required this.onSigning,
    this.name,
    this.showWork = false,
    this.enabled = true,
  });

  Widget _error(BuildContext context, bool show, String text) => show
      ? Padding(padding: const EdgeInsets.only(top: 6), child: Text(text, style: v2Text(size: 12, color: context.v.red)))
      : const SizedBox.shrink();

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    final blocks = <Widget>[
      if (name != null)
        V2Field('Name',
            child: Container(
              height: 42,
              padding: const EdgeInsets.symmetric(horizontal: 14),
              alignment: Alignment.centerLeft,
              decoration: BoxDecoration(
                  color: c.s3, borderRadius: BorderRadius.circular(12), border: Border.all(color: c.line)),
              child: Text(name!, style: v2Text(size: 14, color: c.tx)),
            )),
      V2Field('Department or office',
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            V2Input(
              controller: d.department,
              enabled: enabled,
              hint: "Example: Registrar's Office",
              maxLength: 120,
              onChanged: (_) => onChanged(),
            ),
            _error(context, d.tried && !d.departmentOk, 'Department or office is required'),
          ])),
      V2Field('Contact number',
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            V2Input(
              controller: d.contact,
              enabled: enabled,
              hint: '0917 123 4567',
              keyboard: TextInputType.phone,
              onChanged: (_) => onChanged(),
            ),
            _error(context, d.tried && !d.contactOk, 'Enter a valid contact number'),
          ])),
      if (showWork)
        V2Field('Work requested',
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              V2Input(controller: d.work, enabled: enabled, multiline: true, maxLength: 2000, onChanged: (_) => onChanged()),
              _error(context, d.tried && !d.workOk, 'Describe the work (at least 10 characters)'),
            ])),
      V2Field('Best time for the work',
          child: Wrap(spacing: 8, runSpacing: 8, children: [
            for (final s in scheduleChoices)
              V2Chip(s, on: d.schedule == s, onTap: () {
                d.schedule = d.schedule == s ? null : s;
                onChanged();
              }),
          ])),
      V2Field('Signature',
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            SignaturePad(
              controller: d.signature,
              enabled: enabled,
              onSigning: onSigning,
              height: 130,
              radius: 14,
              background: c.s2,
              borderColor: d.tried && !d.signature.isUsable ? c.red : c.line2,
              ink: c.tx,
              hintColor: c.tx3,
              showLine: false,
            ),
            const SizedBox(height: 6),
            Row(children: [
              Expanded(
                child: Text(
                  d.tried && !d.signature.isUsable ? 'Please sign in the box' : 'Sign with your finger',
                  style: v2Text(size: 12, color: d.tried && !d.signature.isUsable ? c.red : c.tx3),
                ),
              ),
              V2Button('Clear',
                  kind: BtnKind.ghost, size: BtnSize.sm, onPressed: d.signature.isEmpty || !enabled ? null : d.signature.clear),
            ]),
          ])),
      CertifyRow(
        on: d.certified,
        error: d.tried && !d.certified,
        onChanged: (v) {
          if (!enabled) return;
          d.certified = v;
          onChanged();
        },
      ),
    ];
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      for (var i = 0; i < blocks.length; i++) ...[if (i > 0) const SizedBox(height: 16), blocks[i]],
    ]);
  }
}

/* ------------------------------------------------------ sign / fix the form */

/// Signs the Job Order Form for a report that has none yet, or corrects and
/// re-signs one the GSO returned.
class RepFormScreen extends StatefulWidget {
  final String reportId;
  const RepFormScreen({super.key, required this.reportId});

  @override
  State<RepFormScreen> createState() => _RepFormScreenState();
}

class _RepFormScreenState extends State<RepFormScreen> {
  final d = FormDraft();
  Map<String, dynamic>? data;
  bool loading = true;
  bool sending = false;
  bool signing = false;
  String? error;

  @override
  void initState() {
    super.initState();
    d.signature.addListener(() => setState(() {}));
    load();
  }

  @override
  void dispose() {
    d.dispose();
    super.dispose();
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final res = await ApiClient.instance.dio.get('/job-order-forms/prefill/${widget.reportId}');
      final p = Map<String, dynamic>.from(res.data);
      final existing = p['existingForm'];
      final remembered = p['remembered'];
      d.department.text = existing?['department'] ?? remembered?['department'] ?? '';
      d.contact.text = existing?['contactNumber'] ?? remembered?['contactNumber'] ?? '';
      d.work.text = existing?['workRequested'] ?? p['report']['description'] ?? '';
      final sched = existing?['preferredSchedule'] as String?;
      d.schedule = scheduleChoices.contains(sched) ? sched : null;
      d.notes = existing?['notes'] ?? '';
      data = p;
    } catch (e) {
      error = errorMessage(e);
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> send() async {
    setState(() => d.tried = true);
    if (!d.ok) {
      v2Snack(context, 'Please complete the highlighted parts.');
      return;
    }
    setState(() => sending = true);
    try {
      final no = await d.send(widget.reportId);
      if (!mounted) return;
      v2Snack(context, 'Job Order Form $no sent to the GSO.');
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      setState(() => sending = false);
      v2Snack(context, errorMessage(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    return V2Scope(
      child: Builder(builder: (context) {
        final c = context.v;
        final p = data;
        final existing = p?['existingForm'];
        final returned = existing?['status'] == 'RETURNED';
        final canSubmit = p?['canSubmit'] == true;
        return Scaffold(
          backgroundColor: c.bg,
          body: Column(children: [
            const BackTop('Job Order Form'),
            Expanded(
              child: loading
                  ? Center(child: CircularProgressIndicator(color: c.ac))
                  : error != null
                      ? MBody(children: [Note.text(error!, icon: V2Icons.alert), V2Button('Try again', block: true, onPressed: load)])
                      : !canSubmit
                          ? MBody(children: [
                              Note.text(
                                existing != null
                                    ? 'A Job Order Form (${existing['formNo']}) was already sent for this report.'
                                    : 'This report is closed, so a Job Order Form is no longer needed.',
                                icon: V2Icons.info,
                              ),
                            ])
                          : ListView(
                              physics: signing ? const NeverScrollableScrollPhysics() : null,
                              padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
                              children: [
                                if (returned) ...[
                                  Note(
                                    warn: true,
                                    icon: V2Icons.alert,
                                    child: Text.rich(TextSpan(children: [
                                      TextSpan(
                                          text: 'The GSO asked: ',
                                          style: v2Text(size: 13.5, weight: FontWeight.w700, color: c.tx)),
                                      TextSpan(text: existing['decisionNote'] ?? 'Please review the form and sign it again.'),
                                    ])),
                                  ),
                                  const SizedBox(height: 16),
                                ] else ...[
                                  const Sub('The GSO needs your signed request before work starts. We filled in what we could from your report.',
                                      size: 13.5),
                                  const SizedBox(height: 16),
                                ],
                                _reportCard(p!['report'] as Map),
                                const SizedBox(height: 16),
                                FormFields(
                                  d: d,
                                  enabled: !sending,
                                  showWork: !d.workOk,
                                  onChanged: () => setState(() {}),
                                  onSigning: (v) => setState(() => signing = v),
                                ),
                              ],
                            ),
            ),
          ]),
          bottomNavigationBar: loading || error != null || !canSubmit
              ? null
              : StickyBar(children: [
                  Expanded(
                    child: V2Button(returned ? 'Sign and send again' : 'Sign and send',
                        kind: BtnKind.pri, size: BtnSize.lg, block: true, busy: sending, onPressed: send),
                  ),
                ]),
        );
      }),
    );
  }

  Widget _reportCard(Map r) {
    final c = context.v;
    return MCard(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Row(children: [
        PriorityLabel(priorityOf(r)),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${r['category']}', style: v2Text(size: 14, weight: FontWeight.w700, color: c.tx, height: 1.35)),
            Meta('${r['location']} · filled in from your report'),
          ]),
        ),
      ]),
    );
  }
}

/* ------------------------------------------------------------- form detail */

class RepFormDetailScreen extends StatefulWidget {
  final String formId;
  const RepFormDetailScreen({super.key, required this.formId});

  @override
  State<RepFormDetailScreen> createState() => _RepFormDetailScreenState();
}

class _RepFormDetailScreenState extends State<RepFormDetailScreen> {
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

  // a 5-minute link, opened in the phone's browser or PDF viewer
  Future<void> openPdf() async {
    setState(() => opening = true);
    try {
      final res = await ApiClient.instance.dio.post('/job-order-forms/${widget.formId}/pdf-link');
      final ok = await launchUrl(Uri.parse('${AppConfig.baseUrl}${res.data['path']}'), mode: LaunchMode.externalApplication);
      if (!ok && mounted) v2Snack(context, 'No app could open the PDF on this phone.');
    } catch (e) {
      if (mounted) v2Snack(context, errorMessage(e));
    }
    if (mounted) setState(() => opening = false);
  }

  @override
  Widget build(BuildContext context) {
    return V2Scope(
      child: Builder(builder: (context) {
        final c = context.v;
        return Scaffold(
          backgroundColor: c.bg,
          body: Column(children: [
            BackTop(form?['formNo'] as String? ?? 'Job Order Form'),
            Expanded(
              child: loading
                  ? Center(child: CircularProgressIndicator(color: c.ac))
                  : error != null
                      ? MBody(children: [Note.text(error!, icon: V2Icons.alert), V2Button('Try again', block: true, onPressed: load)])
                      : _content(),
            ),
          ]),
        );
      }),
    );
  }

  Widget _content() {
    final c = context.v;
    final f = form!;
    final status = f['status'] as String;
    final job = f['report']?['jobOrder'];
    final jobNo = job != null && job['status'] != 'CANCELLED' ? job['jobOrderNo'] as String? : null;
    final steps = <TimelineEntry>[
      if (f['decidedAt'] != null)
        TimelineEntry(status == 'APPROVED' ? 'Approved' : 'Returned for changes', dayAndTime(f['decidedAt']),
            dot: status == 'APPROVED' ? c.acf : c.red),
      if (f['receivedAt'] != null) TimelineEntry('Received', dayAndTime(f['receivedAt']), dot: c.acf),
      TimelineEntry('Sent', dayAndTime(f['submittedAt']), dot: c.acf),
    ];

    return MBody(bottom: 40, onRefresh: load, children: [
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [PriorityLabel(priorityOf(f)), const SizedBox(width: 8), formStatus(status)]),
        const SizedBox(height: 8),
        H1('${f['categoryName']}', size: 22),
      ]),
      if (status == 'RETURNED') ...[
        Note(
          warn: true,
          icon: V2Icons.alert,
          child: Text.rich(TextSpan(children: [
            TextSpan(text: 'The GSO asked: ', style: v2Text(size: 13.5, weight: FontWeight.w700, color: c.tx)),
            TextSpan(text: f['decisionNote'] ?? 'Please review the form and sign it again.'),
          ])),
        ),
        V2Button('Fix and sign again', kind: BtnKind.pri, block: true, onPressed: () async {
          final done = await Navigator.push<bool>(
              context, MaterialPageRoute(builder: (_) => RepFormScreen(reportId: f['reportId'] as String)));
          if (done == true) load();
        }),
      ] else if (f['decisionNote'] != null || jobNo != null)
        Note(
          icon: V2Icons.info,
          child: Text.rich(TextSpan(children: [
            TextSpan(text: 'GSO remarks: ', style: v2Text(size: 13.5, weight: FontWeight.w700, color: c.tx)),
            TextSpan(text: [if (f['decisionNote'] != null) '${f['decisionNote']}', if (jobNo != null) 'Job order $jobNo.'].join(' ')),
          ])),
        ),
      MCard(
        child: Column(children: [
          FactLine(V2Icons.pin, '${f['locationText']}'),
          FactLine(V2Icons.user, '${f['department']}'),
          FactLine(V2Icons.doc, 'Contact ${f['contactNumber']}'),
          FactLine(V2Icons.calendar, 'Best time: ${f['preferredSchedule'] ?? 'Any time'}'),
        ]),
      ),
      MCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const H2('Progress'),
          const SizedBox(height: 10),
          V2Timeline(steps),
        ]),
      ),
      MCard(
        child: Row(children: [
          IconSquare(f['integrityOk'] == true ? V2Icons.check : V2Icons.alert,
              f['integrityOk'] == true ? c.acf : const Color(0xFFD6456A)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Your signature', style: v2Text(size: 14.5, weight: FontWeight.w700, color: c.tx, height: 1.35)),
              Meta('Signed ${dayAndTime(f['signedAt'])} · '
                  '${f['integrityOk'] == true ? 'unchanged since signing' : 'CHANGED after signing'}',
                  color: f['integrityOk'] == true ? null : c.red),
            ]),
          ),
        ]),
      ),
      V2Button('Download PDF', icon: V2Icons.doc, block: true, busy: opening, onPressed: openPdf),
    ]);
  }
}
