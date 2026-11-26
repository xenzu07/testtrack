import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../auth/auth_provider.dart';
import '../tech/v2.dart';
import 'rep_common.dart';
import 'rep_form.dart';

/// What happened after sending: the new report, and the form number or the
/// reason the form could not be sent.
class SentResult {
  final Map<String, dynamic> report;
  final String? formNo;
  final String? formError;
  SentResult(this.report, this.formNo, this.formError);
}

/// New report in four short steps: where, what, how serious, sign the form.
class RepNewReportScreen extends StatefulWidget {
  const RepNewReportScreen({super.key});

  @override
  State<RepNewReportScreen> createState() => _RepNewReportScreenState();
}

class _RepNewReportScreenState extends State<RepNewReportScreen> {
  int step = 0;
  List<Map<String, dynamic>> locations = [];
  List<Map<String, dynamic>> categories = [];
  bool loading = true;
  String? loadError;

  String? building;
  String? floor;
  String? locationId;
  String? categoryId;
  final desc = TextEditingController();
  XFile? photo;
  Uint8List? photoBytes;
  bool? hazard;
  bool? usable;
  int? affected;
  final form = FormDraft();
  bool signing = false;
  bool sending = false;
  SentResult? sent;

  @override
  void initState() {
    super.initState();
    form.signature.addListener(() => setState(() {}));
    load();
  }

  @override
  void dispose() {
    desc.dispose();
    form.dispose();
    super.dispose();
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      loadError = null;
    });
    try {
      final res = await ApiClient.instance.dio.get('/reports/options');
      locations = List<Map<String, dynamic>>.from(res.data['locations']);
      categories = List<Map<String, dynamic>>.from(res.data['categories']);
      // department and contact number are remembered from the last form
      try {
        final mine = await ApiClient.instance.dio.get('/job-order-forms/mine');
        final last = (mine.data as List).cast<Map>().firstOrNull;
        if (last != null) {
          form.department.text = last['department'] as String? ?? '';
          form.contact.text = last['contactNumber'] as String? ?? '';
        }
      } catch (_) {}
    } catch (e) {
      loadError = errorMessage(e);
    }
    if (mounted) setState(() => loading = false);
  }

  List<String> get buildings => locations.map((l) => l['building'] as String).toSet().toList();
  List<String> get floors =>
      locations.where((l) => l['building'] == building).map((l) => l['floor'] as String).toSet().toList();
  List<Map<String, dynamic>> get rooms =>
      locations.where((l) => l['building'] == building && l['floor'] == floor).toList();
  Map<String, dynamic>? get location => locations.where((l) => l['id'] == locationId).firstOrNull;
  Map<String, dynamic>? get category => categories.where((c) => c['id'] == categoryId).firstOrNull;

  bool get stepOk => switch (step) {
        0 => locationId != null,
        1 => categoryId != null && desc.text.trim().length >= 10 && photo != null,
        2 => hazard != null && usable != null && affected != null,
        _ => true,
      };

  Future<void> cancel() async {
    final ok = step == 0 && categoryId == null
        ? true
        : await showDialog<bool>(
            context: context,
            builder: (ctx) => AlertDialog(
              title: Text('Discard this report?', style: v2Text(size: 18, weight: FontWeight.w700, color: ctx.v.tx)),
              content: Text('What you entered will be lost.', style: v2Text(color: ctx.v.tx2)),
              actions: [
                V2Button('Keep editing', kind: BtnKind.ghost, onPressed: () => Navigator.pop(ctx, false)),
                V2Button('Discard', kind: BtnKind.danger, onPressed: () => Navigator.pop(ctx, true)),
              ],
            ),
          );
    if (ok == true && mounted) Navigator.pop(context);
  }

  Future<void> pick(ImageSource source) async {
    // resizing and quality keep uploads small for campus bandwidth
    final x = await takePhoto(source);
    if (x == null) return;
    final bytes = await x.readAsBytes();
    setState(() {
      photo = x;
      photoBytes = bytes;
    });
  }

  // the report first, then its signed Job Order Form
  Future<void> send() async {
    form.work.text = desc.text.trim();
    setState(() => form.tried = true);
    if (!form.ok) {
      v2Snack(context, 'Please complete the highlighted parts.');
      return;
    }
    setState(() => sending = true);
    Map<String, dynamic> report;
    try {
      final png = photo!.name.toLowerCase().endsWith('.png');
      final res = await ApiClient.instance.dio.post('/reports',
          data: FormData.fromMap({
            'locationId': locationId,
            'categoryId': categoryId,
            'affectedPeople': affected,
            'safetyHazard': hazard,
            'blocksUse': !(usable ?? true),
            'description': desc.text.trim(),
            'photo': MultipartFile.fromBytes(photoBytes!,
                filename: png ? 'photo.png' : 'photo.jpg', contentType: DioMediaType.parse(png ? 'image/png' : 'image/jpeg')),
          }));
      report = Map<String, dynamic>.from(res.data);
    } catch (e) {
      if (!mounted) return;
      setState(() => sending = false);
      v2Snack(context, errorMessage(e));
      return;
    }
    String? formNo;
    String? formError;
    try {
      formNo = await form.send(report['id'] as String);
    } catch (e) {
      formError = errorMessage(e);
    }
    if (!mounted) return;
    setState(() {
      sending = false;
      sent = SentResult(report, formNo, formError);
    });
  }

  @override
  Widget build(BuildContext context) {
    return V2Scope(
      child: Builder(builder: (context) {
        final c = context.v;
        return PopScope(
          canPop: sent != null,
          onPopInvokedWithResult: (popped, _) {
            if (popped || sending) return;
            if (step > 0) {
              setState(() => step -= 1);
            } else {
              cancel();
            }
          },
          child: Scaffold(
            backgroundColor: c.bg,
            body: loading
                ? Center(child: CircularProgressIndicator(color: c.ac))
                : loadError != null
                    ? SafeArea(
                        child: MBody(top: 24, children: [
                          Note.text(loadError!, icon: V2Icons.alert),
                          V2Button('Try again', block: true, onPressed: load),
                        ]),
                      )
                    : sent != null
                        ? _sent()
                        : Column(children: [
                            MTop(padding: const EdgeInsets.fromLTRB(20, 18, 20, 6), children: [
                              V2IconButton(V2Icons.close, tooltip: 'Cancel', plain: true, onPressed: sending ? null : cancel),
                              Expanded(
                                child: Text('New report',
                                    textAlign: TextAlign.center,
                                    style: v2Text(size: 16, weight: FontWeight.w700, color: c.tx)),
                              ),
                              SizedBox(width: 40, child: Meta('${step + 1}/4', align: TextAlign.right)),
                            ]),
                            Padding(
                              padding: const EdgeInsets.fromLTRB(20, 0, 20, 18),
                              child: StepBars(total: 4, done: step + 1),
                            ),
                            // keyed by step: each step opens at the top, not at the previous
                            // step's scroll position
                            Expanded(child: KeyedSubtree(key: ValueKey(step), child: [_where, _what, _impact, _sign][step]())),
                          ]),
            bottomNavigationBar: loading || loadError != null
                ? null
                : sent != null
                    ? _sentBar()
                    : StickyBar(children: [
                        if (step > 0)
                          SizedBox(
                            width: 110,
                            child: V2Button('Back',
                                size: BtnSize.lg, block: true, onPressed: sending ? null : () => setState(() => step -= 1)),
                          ),
                        Expanded(
                          child: V2Button(
                            switch (step) { 2 => 'Next: Job Order Form', 3 => 'Sign and send report', _ => 'Next' },
                            kind: BtnKind.pri,
                            size: BtnSize.lg,
                            block: true,
                            busy: sending,
                            onPressed: !stepOk ? null : (step == 3 ? send : () => setState(() => step += 1)),
                          ),
                        ),
                      ]),
          ),
        );
      }),
    );
  }

  /* -------------------------------------------------------------- 1 where */

  Widget _where() {
    return MBody(bottom: 24, children: [
      const H1('Where is the problem?', size: 22),
      CardRows([
        _pick(V2Icons.building, 'Building', building, () async {
          final v = await _choose('Building', buildings);
          if (v != null) {
            setState(() {
              building = v;
              final f = floors;
              floor = f.length == 1 ? f.first : null;
              final r = floor == null ? <Map<String, dynamic>>[] : rooms;
              locationId = r.length == 1 ? r.first['id'] as String : null;
            });
          }
        }),
        _pick(V2Icons.layers, 'Floor', floor, building == null ? null : () async {
          final v = await _choose('Floor', floors);
          if (v != null) {
            setState(() {
              floor = v;
              final r = rooms;
              locationId = r.length == 1 ? r.first['id'] as String : null;
            });
          }
        }),
        _pick(V2Icons.door, 'Room', location?['room'] as String?, floor == null ? null : () async {
          final list = rooms;
          final v = await _choose('Room', [for (final r in list) r['room'] as String]);
          if (v != null) setState(() => locationId = list.firstWhere((r) => r['room'] == v)['id'] as String);
        }),
      ]),
      Note.text("Can't find the room? Pick the nearest one and mention it in the next step.", icon: V2Icons.info),
    ]);
  }

  Widget _pick(String icon, String label, String? value, VoidCallback? onTap) {
    final c = context.v;
    return Opacity(
      opacity: onTap == null ? 0.5 : 1,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(children: [
            V2Icon(icon, size: 20, color: c.tx3),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(label, style: v2Text(size: 12, color: c.tx3, height: 1.3)),
                Text(value ?? 'Choose ${label.toLowerCase()}',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: v2Text(size: 14, weight: FontWeight.w600, color: value == null ? c.tx3 : c.tx, height: 1.4)),
              ]),
            ),
            const SizedBox(width: 12),
            V2Icon(V2Icons.chevronDown, size: 20, color: c.tx3),
          ]),
        ),
      ),
    );
  }

  /// A list to pick from, in a sheet; long lists can be searched.
  Future<String?> _choose(String title, List<String> options) {
    final q = TextEditingController();
    return showV2Sheet<String>(context, (ctx, setSheet) {
      final c = ctx.v;
      final shown = options.where((o) => o.toLowerCase().contains(q.text.trim().toLowerCase())).toList();
      return [
        H2(title, size: 20),
        if (options.length > 8)
          V2Input(controller: q, hint: 'Search', onChanged: (_) => setSheet(() {})),
        ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.5),
          child: SingleChildScrollView(child: CardRows([
            for (final o in shown)
              InkWell(
                onTap: () => Navigator.pop(ctx, o),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(o, style: v2Text(size: 14, weight: FontWeight.w600, color: c.tx)),
                  ),
                ),
              ),
            if (shown.isEmpty) Padding(padding: const EdgeInsets.all(16), child: Meta('Nothing matches "${q.text}".')),
          ])),
        ),
      ];
    }, onDispose: q.dispose);
  }

  /* --------------------------------------------------------------- 2 what */

  Widget _what() {
    return MBody(bottom: 24, children: [
      const H1("What's wrong?", size: 22),
      LayoutBuilder(builder: (context, box) {
        final w = (box.maxWidth - 20) / 3;
        return Wrap(spacing: 10, runSpacing: 10, children: [
          for (final cat in categories)
            SizedBox(width: w, child: _tile(cat)),
        ]);
      }),
      V2Field('Describe it',
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            V2Input(
              controller: desc,
              multiline: true,
              maxLength: 2000,
              hint: 'What is wrong, and since when? Example: Ceiling light flickers and buzzes.',
              onChanged: (_) => setState(() {}),
            ),
            if (desc.text.isNotEmpty && desc.text.trim().length < 10)
              Padding(padding: const EdgeInsets.only(top: 6), child: Meta('A little more, please (at least 10 characters).')),
          ])),
      V2Field('Photo (required)',
          child: PhotoPicker(
            bytes: photoBytes,
            emptyText: "No photo yet. Show the GSO what's wrong.",
            onPick: pick,
            onRemove: () => setState(() {
              photo = null;
              photoBytes = null;
            }),
          )),
    ]);
  }

  Widget _tile(Map cat) {
    final c = context.v;
    final on = categoryId == cat['id'];
    final look = categoryLook(cat['name'] as String);
    return Semantics(
      selected: on,
      button: true,
      child: Material(
        color: on ? c.acs : c.s1,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: on ? c.acl : c.line)),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () => setState(() => categoryId = cat['id'] as String),
          child: Container(
            constraints: const BoxConstraints(minHeight: 98),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 14),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              IconSquare(look.icon, look.color, size: 36, iconSize: 18),
              const SizedBox(height: 8),
              Text(shortCategory(cat['name'] as String),
                  textAlign: TextAlign.center,
                  style: v2Text(size: 12.5, weight: FontWeight.w600, color: on ? c.tx : c.tx2, height: 1.35)),
            ]),
          ),
        ),
      ),
    );
  }

  /* ------------------------------------------------------------- 3 impact */

  Widget _impact() {
    final c = context.v;
    return MBody(bottom: 24, children: [
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const H1('How serious is it?', size: 22),
        const SizedBox(height: 4),
        const Sub('Your answers set the priority, so urgent problems are fixed first.', size: 13.5),
      ]),
      V2Field('Could someone get hurt?',
          child: OptGrid<bool>(options: const [(true, 'Yes'), (false, 'No')], value: hazard, onChanged: (v) => setState(() => hazard = v))),
      V2Field('Can the room still be used?',
          child: OptGrid<bool>(options: const [(true, 'Yes'), (false, 'No')], value: usable, onChanged: (v) => setState(() => usable = v))),
      V2Field('How many people are affected?',
          child: OptGrid<int>(
            options: const [(0, 'Just me'), (1, '2 to 10'), (2, '11 to 50'), (3, 'More than 50')],
            value: affected,
            onChanged: (v) => setState(() => affected = v),
          )),
      MCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Meta('YOUR REPORT', weight: FontWeight.w700),
          const SizedBox(height: 10),
          Row(children: [
            PhotoBox(width: 56, height: 56, image: photoBytes == null ? null : MemoryImage(photoBytes!)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(shortCategory(category?['name'] as String? ?? ''),
                    style: v2Text(size: 14, weight: FontWeight.w700, color: c.tx, height: 1.35)),
                Meta(placeLong(location)),
              ]),
            ),
            TextLink('Edit', onTap: () => setState(() => step = 1)),
          ]),
        ]),
      ),
    ]);
  }

  /* --------------------------------------------------------------- 4 sign */

  Widget _sign() {
    final c = context.v;
    final u = context.read<AuthProvider>().user;
    final type = u?.userType;
    return ListView(
      physics: signing ? const NeverScrollableScrollPhysics() : null,
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
      children: [
        const H1('Sign the Job Order Form', size: 22),
        const SizedBox(height: 4),
        const Sub('The GSO needs your signed request before work starts. We filled in what we could from your report.',
            size: 13.5),
        const SizedBox(height: 16),
        MCard(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(children: [
            IconSquare.category(category?['name'] as String?, size: 36),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${category?['name'] ?? ''}', style: v2Text(size: 14, weight: FontWeight.w700, color: c.tx, height: 1.35)),
                Meta('${placeShort(location)} · filled in from your report'),
              ]),
            ),
          ]),
        ),
        const SizedBox(height: 16),
        FormFields(
          d: form,
          enabled: !sending,
          name: [u?.fullName ?? '', if (type != null && type.isNotEmpty) type[0].toUpperCase() + type.substring(1)].join(' · '),
          onChanged: () => setState(() {}),
          onSigning: (v) => setState(() => signing = v),
        ),
      ],
    );
  }

  /* --------------------------------------------------------------- sent */

  Widget _sent() {
    final c = context.v;
    final s = sent!;
    final r = s.report;
    final first = (context.read<AuthProvider>().user?.fullName ?? '').trim().split(' ').first;
    const people = ['Only you affected', '2–10 people affected', '11–50 people affected', 'More than 50 people affected'];
    final impact = [
      if (hazard == true) 'Safety hazard',
      if (affected != null) people[affected!],
      if (usable == false) "Room can't be used",
    ].join(' · ');
    return Column(children: [
      MTop(padding: const EdgeInsets.fromLTRB(20, 18, 20, 6), children: [
        const SizedBox(width: 40),
        Expanded(
          child: Text('New Report', textAlign: TextAlign.center, style: v2Text(size: 16, weight: FontWeight.w700, color: c.tx)),
        ),
        const SizedBox(width: 40, child: Meta('Sent', align: TextAlign.right)),
      ]),
      Expanded(
        child: MBody(top: 18, bottom: 24, children: [
          Column(children: [
            Container(
              width: 60,
              height: 60,
              alignment: Alignment.center,
              decoration: BoxDecoration(color: c.acf, shape: BoxShape.circle),
              child: const V2Icon(V2Icons.check, size: 28, color: Colors.white),
            ),
            const SizedBox(height: 10),
            H1(first.isEmpty ? "Thanks. It's sent." : "Thanks, $first. It's sent.", size: 24),
            const SizedBox(height: 10),
            Sub(
              s.formNo != null
                  ? 'Your report and signed Job Order Form are with the GSO. They review it and send it to the right team.'
                  : 'Your report is with the GSO. They review it and send it to the right team.',
              align: TextAlign.center,
            ),
          ]),
          if (s.formError != null)
            Note(
              warn: true,
              icon: V2Icons.alert,
              child: Text("The Job Order Form didn't go through (${s.formError}). Sign it from Home under Needs you."),
            ),
          MCard(
            child: Column(children: [
              FactLine(categoryLook(r['category']?['name'] as String?).icon, '${r['category']?['name'] ?? ''}'),
              FactLine(V2Icons.pin, placeLong(r['location'] as Map?)),
              if (impact.isNotEmpty) FactLine(V2Icons.warning, impact),
              Container(
                margin: const EdgeInsets.only(top: 12),
                padding: const EdgeInsets.only(top: 12),
                decoration: BoxDecoration(border: Border(top: BorderSide(color: c.line))),
                child: Row(children: [
                  const Expanded(child: Meta('Priority set by the system', weight: FontWeight.w600)),
                  PriorityLabel(priorityOf(r)),
                ]),
              ),
            ]),
          ),
          Note.text("You'll get a notification at each step. Track it any time in My Reports.", icon: V2Icons.info),
        ]),
      ),
    ]);
  }

  Widget _sentBar() {
    final c = context.v;
    return Container(
      decoration: BoxDecoration(color: c.s1, border: Border(top: BorderSide(color: c.line))),
      padding: EdgeInsets.fromLTRB(20, 12, 20, 28 + MediaQuery.of(context).padding.bottom * 0.5),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        V2Button('View My Report',
            kind: BtnKind.pri, size: BtnSize.lg, block: true, onPressed: () => Navigator.pop(context, sent)),
        const SizedBox(height: 10),
        V2Button('Back to Home', kind: BtnKind.ghost, block: true, onPressed: () => Navigator.pop(context, true)),
      ]),
    );
  }
}
