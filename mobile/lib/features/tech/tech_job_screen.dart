import 'dart:async';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/api_client.dart';
import '../../core/config.dart';
import '../../core/realtime.dart';
import 'v2.dart';

/// True when [job] was offered to this technician and still needs an answer.
bool awaitingMyAnswer(Map job) => job['status'] == 'ASSIGNED' && job['assignmentStatus'] == 'PENDING';

/// Status line of a job as the technician sees it (dot + words, or a tag).
Widget jobStatus(Map job, {bool long = true}) {
  if (awaitingMyAnswer(job)) return const V2Tag('New job for you', tone: TagTone.good);
  switch (job['status']) {
    case 'ASSIGNED':
      return StatusDot(long ? 'Accepted · Not Started' : 'Not Started', StKind.tech);
    case 'IN_PROGRESS':
      if (!long) {
        final started = startedAt(job);
        final day = started == null ? null : DateTime.now().difference(started).inDays + 1;
        return StatusDot(day == null ? 'In Progress' : 'In Progress · Day $day', StKind.work);
      }
      return const StatusDot("You're working on this", StKind.work);
    case 'DELAYED':
      final d = openDelay(job);
      final why = d == null ? 'waiting' : _lowerFirst(d['reason'] as String);
      return StatusDot('Paused · $why', StKind.wait);
    case 'COMPLETED':
      return const StatusDot('Waiting for the GSO check', StKind.check);
    case 'CLOSED':
      return const StatusDot('Closed', StKind.done);
    case 'CANCELLED':
      return const StatusDot('Cancelled', StKind.neutral);
    default:
      return StatusDot('${job['status']}', StKind.neutral);
  }
}

String _lowerFirst(String s) => s.isEmpty ? s : s[0].toLowerCase() + s.substring(1);

Map? openDelay(Map job) {
  for (final d in (job['delays'] as List? ?? const [])) {
    if (d['resolvedAt'] == null) return d as Map;
  }
  return null;
}

/// When work first started (the first move to In progress).
DateTime? startedAt(Map job) {
  for (final l in (job['report']?['logs'] as List? ?? const [])) {
    if (l['newStatus'] == 'IN_PROGRESS' && l['oldStatus'] == 'ASSIGNED') {
      return DateTime.tryParse(l['createdAt'] as String)?.toLocal();
    }
  }
  return null;
}

/// "Old Building · 2nd Floor · Room 204".
String placeText(Map loc, {bool withFloor = true}) =>
    [loc['building'], if (withFloor) loc['floor'], loc['room']].where((x) => x != null && '$x'.isNotEmpty).join(' · ');

class TechJobScreen extends StatefulWidget {
  final String jobId;
  const TechJobScreen({super.key, required this.jobId});

  @override
  State<TechJobScreen> createState() => _TechJobScreenState();
}

class _TechJobScreenState extends State<TechJobScreen> {
  Map<String, dynamic>? job;
  bool loading = true;
  bool busy = false;
  String? error;
  final note = TextEditingController();
  StreamSubscription<Map<String, dynamic>>? _sub;

  @override
  void initState() {
    super.initState();
    load();
    _sub = Realtime.instance.events.listen((e) {
      if (mounted && e['jobOrderId'] == widget.jobId) load(silent: true);
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    note.dispose();
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
      final res = await ApiClient.instance.dio.get('/job-orders/${widget.jobId}');
      job = Map<String, dynamic>.from(res.data);
      error = null;
    } catch (e) {
      if (!silent) error = errorMessage(e);
    }
    if (mounted) setState(() => loading = false);
  }

  /* ------------------------------------------------------------ actions */

  Future<bool> _run(Future<Response> Function() call, String done) async {
    setState(() => busy = true);
    try {
      final res = await call();
      if (res.data is Map && (res.data as Map).containsKey('jobOrderNo')) {
        job = Map<String, dynamic>.from(res.data);
      } else {
        await load(silent: true);
      }
      if (mounted) v2Snack(context, done);
      return true;
    } catch (e) {
      if (mounted) v2Snack(context, errorMessage(e));
      return false;
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  FormData _form(Map<String, dynamic> fields, XFile? photo, Uint8List? bytes) {
    final map = <String, dynamic>{...fields};
    if (photo != null && bytes != null) {
      final png = photo.name.toLowerCase().endsWith('.png');
      map['photo'] = MultipartFile.fromBytes(
        bytes,
        filename: png ? 'photo.png' : 'photo.jpg',
        contentType: DioMediaType.parse(png ? 'image/png' : 'image/jpeg'),
      );
    }
    return FormData.fromMap(map);
  }

  String get _path => '/job-orders/${widget.jobId}';

  Future<void> accept() => _run(() => ApiClient.instance.dio.post('$_path/accept'), "Job accepted. It's in My jobs.");

  Future<void> startWork() {
    final text = note.text.trim();
    return _run(
      () => ApiClient.instance.dio.patch('$_path/status',
          data: _form({'status': 'IN_PROGRESS', if (text.isNotEmpty) 'remarks': text}, null, null)),
      'Work started.',
    ).then((ok) {
      if (ok) note.clear();
    });
  }

  Future<void> resume() =>
      _run(() => ApiClient.instance.dio.post('$_path/resume', data: <String, dynamic>{}), 'Work resumed.');

  /* -------------------------------------------------------------- sheets */

  Future<void> declineSheet() async {
    const reasons = ['On leave', 'Too many jobs', 'Not my trade', 'Other'];
    String? chip;
    final reason = TextEditingController();
    var sending = false;
    final declined = await showV2Sheet<bool>(context, (ctx, setSheet) {
      final ok = reason.text.trim().length >= 5;
      return [
        const SheetHead("Why can't you take this job?", 'The GSO sees your reason and offers the job to someone else.'),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final r in reasons)
            V2Chip(r, on: chip == r, onTap: () {
              setSheet(() {
                final prev = chip;
                chip = r;
                final t = reason.text.trim();
                if (r == 'Other') {
                  if (reasons.contains(t) || t == '$prev.') reason.clear();
                } else if (t.isEmpty || reasons.any((x) => t == x || t == '$x.')) {
                  reason.text = '$r.';
                }
              });
            }),
        ]),
        V2Field('Reason',
            child: V2Input(
              controller: reason,
              multiline: true,
              minHeight: 72,
              maxLength: 500,
              hint: 'Example: On leave until Friday.',
              onChanged: (_) => setSheet(() {}),
            )),
        V2Button(
          'Decline job',
          kind: BtnKind.danger,
          size: BtnSize.lg,
          block: true,
          busy: sending,
          onPressed: !ok
              ? null
              : () async {
                  setSheet(() => sending = true);
                  try {
                    await ApiClient.instance.dio.post('$_path/decline', data: {'reason': reason.text.trim()});
                    if (ctx.mounted) Navigator.pop(ctx, true);
                  } catch (e) {
                    if (!ctx.mounted) return;
                    setSheet(() => sending = false);
                    v2Snack(ctx, errorMessage(e));
                  }
                },
        ),
        Transform.translate(
          offset: const Offset(0, -8),
          child: V2Button('Back', kind: BtnKind.ghost, block: true, onPressed: () => Navigator.pop(ctx)),
        ),
      ];
    }, onDispose: reason.dispose);
    if (declined == true && mounted) {
      v2Snack(context, 'Job declined. The GSO has been told.');
      Navigator.pop(context, true);
    }
  }

  Future<void> updateSheet() async {
    final text = TextEditingController();
    XFile? photo;
    Uint8List? bytes;
    var sending = false;
    await showV2Sheet<void>(context, (ctx, setSheet) {
      final ok = text.text.trim().length >= 3;
      return [
        const SheetHead('Post an update', 'The reporter and the GSO see it. The job stays in progress.'),
        V2Field("What's happening?",
            child: V2Input(
              controller: text,
              multiline: true,
              hint: 'Example: Ballast on spotlight 2 is burnt. Replacing it today.',
              onChanged: (_) => setSheet(() {}),
            )),
        V2Field('Photo (optional)',
            child: PhotoPicker(
              bytes: bytes,
              enabled: !sending,
              emptyText: 'No photo yet. Show the update.',
              onPick: (source) async {
                final picked = await takePhoto(source);
                if (picked == null) return;
                final b = await picked.readAsBytes();
                if (!ctx.mounted) return;
                setSheet(() {
                  photo = picked;
                  bytes = b;
                });
              },
              onRemove: () => setSheet(() {
                photo = null;
                bytes = null;
              }),
            )),
        V2Button(
          'Post update',
          icon: V2Icons.send,
          kind: BtnKind.pri,
          size: BtnSize.lg,
          block: true,
          busy: sending,
          onPressed: !ok
              ? null
              : () async {
                  setSheet(() => sending = true);
                  final sent = await _run(
                    () => ApiClient.instance.dio
                        .post('$_path/progress', data: _form({'remarks': text.text.trim()}, photo, bytes)),
                    'Update posted.',
                  );
                  if (!ctx.mounted) return;
                  if (sent) {
                    Navigator.pop(ctx);
                  } else {
                    setSheet(() => sending = false);
                  }
                },
        ),
        Transform.translate(
          offset: const Offset(0, -8),
          child: V2Button('Cancel', kind: BtnKind.ghost, block: true, onPressed: () => Navigator.pop(ctx)),
        ),
      ];
    }, onDispose: text.dispose);
  }

  Future<void> delaySheet() async {
    const reasons = ['Waiting for materials', 'Needs another trade', "Can't access the room", 'Other'];
    var chip = reasons.first;
    final materials = TextEditingController(text: job?['materialsNote'] as String? ?? '');
    final details = TextEditingController();
    DateTime? date;
    var sending = false;
    await showV2Sheet<void>(context, (ctx, setSheet) {
      final isMaterials = chip == reasons.first;
      final ok = chip == 'Other' ? details.text.trim().length >= 3 : true;
      return [
        const SheetHead("What's holding it up?", 'The job pauses and the reporter is told why.'),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final r in reasons) V2Chip(r, on: chip == r, onTap: () => setSheet(() => chip = r)),
        ]),
        if (isMaterials)
          V2Field('Materials needed',
              child: V2Input(controller: materials, hint: 'Example: Spotlight ballast, 70W · 1 pc'))
        else
          V2Field(chip == 'Other' ? 'What is the reason?' : 'Details (optional)',
              child: V2Input(
                controller: details,
                hint: chip == 'Other' ? 'Describe what is holding it up' : 'Example: Needs an electrician first',
                onChanged: (_) => setSheet(() {}),
              )),
        V2Field('New target date (optional)', child: _dateField(ctx, date, (d) => setSheet(() => date = d))),
        V2Button(
          'Pause the job',
          kind: BtnKind.pri,
          size: BtnSize.lg,
          block: true,
          busy: sending,
          onPressed: !ok
              ? null
              : () async {
                  setSheet(() => sending = true);
                  final extra = details.text.trim();
                  final reason = chip == 'Other' ? extra : (extra.isEmpty ? chip : '$chip: $extra');
                  final m = materials.text.trim();
                  final sent = await _run(
                    () => ApiClient.instance.dio.post('$_path/delay', data: {
                      'reason': reason,
                      if (isMaterials && m.isNotEmpty) 'materialsNote': m,
                      if (date != null)
                        'revisedTargetDate':
                            '${date!.year}-${date!.month.toString().padLeft(2, '0')}-${date!.day.toString().padLeft(2, '0')}',
                    }),
                    'Job paused. The reporter has been told.',
                  );
                  if (!ctx.mounted) return;
                  if (sent) {
                    Navigator.pop(ctx);
                  } else {
                    setSheet(() => sending = false);
                  }
                },
        ),
        Transform.translate(
          offset: const Offset(0, -8),
          child: V2Button('Cancel', kind: BtnKind.ghost, block: true, onPressed: () => Navigator.pop(ctx)),
        ),
      ];
    }, onDispose: () {
      materials.dispose();
      details.dispose();
    });
  }

  Future<void> finishSheet() async {
    final text = TextEditingController();
    XFile? photo;
    Uint8List? bytes;
    var sending = false;
    await showV2Sheet<void>(context, (ctx, setSheet) {
      Future<void> pick(ImageSource source) async {
        final picked = await takePhoto(source);
        if (picked == null) return;
        final b = await picked.readAsBytes();
        if (!ctx.mounted) return;
        setSheet(() {
          photo = picked;
          bytes = b;
        });
      }

      return [
        const SheetHead('Finish the job', 'The GSO checks your photo before closing the report.'),
        V2Field('Photo of the finished work',
            child: PhotoPicker(
              bytes: bytes,
              enabled: !sending,
              emptyText: 'No photo yet. Show the finished work.',
              onPick: pick,
              onRemove: () => setSheet(() {
                photo = null;
                bytes = null;
              }),
            )),
        V2Field('What did you do? (optional)',
            child: V2Input(
              controller: text,
              multiline: true,
              minHeight: 72,
              hint: 'Example: Replaced the ballast and tightened the loose connector.',
            )),
        V2Button(
          'Mark as done',
          icon: V2Icons.check,
          kind: BtnKind.pri,
          size: BtnSize.lg,
          block: true,
          busy: sending,
          onPressed: bytes == null
              ? null
              : () async {
                  setSheet(() => sending = true);
                  final remarks = text.text.trim();
                  final sent = await _run(
                    () => ApiClient.instance.dio.patch('$_path/status',
                        data: _form({'status': 'COMPLETED', if (remarks.isNotEmpty) 'remarks': remarks}, photo, bytes)),
                    'Marked as done. The GSO will check the work.',
                  );
                  if (!ctx.mounted) return;
                  if (sent) {
                    Navigator.pop(ctx);
                  } else {
                    setSheet(() => sending = false);
                  }
                },
        ),
        Transform.translate(
          offset: const Offset(0, -8),
          child: V2Button('Cancel', kind: BtnKind.ghost, block: true, onPressed: () => Navigator.pop(ctx)),
        ),
      ];
    }, onDispose: text.dispose);
  }

  Widget _dateField(BuildContext ctx, DateTime? date, ValueChanged<DateTime?> onChanged) {
    final c = ctx.v;
    return Material(
      color: c.s3,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: c.line)),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () async {
          final now = DateTime.now();
          final picked = await showDatePicker(
            context: ctx,
            initialDate: date ?? now.add(const Duration(days: 3)),
            firstDate: now,
            lastDate: now.add(const Duration(days: 365)),
          );
          if (picked != null) onChanged(picked);
        },
        child: Container(
          height: 42,
          padding: const EdgeInsets.only(left: 14, right: 6),
          child: Row(children: [
            V2Icon(V2Icons.calendar, size: 17, color: c.tx3),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                date == null
                    ? 'Pick a date'
                    : '${shortLocalDay(date.toIso8601String())}, ${date.year}',
                style: v2Text(size: 14, color: date == null ? c.tx3 : c.tx),
              ),
            ),
            if (date != null)
              SizedBox(
                width: 28,
                height: 28,
                child: IconButton(
                  padding: EdgeInsets.zero,
                  tooltip: 'Clear date',
                  onPressed: () => onChanged(null),
                  icon: V2Icon(V2Icons.close, size: 16, color: c.tx2),
                ),
              ),
          ]),
        ),
      ),
    );
  }

  Future<void> _moreMenu(BuildContext anchor) async {
    final box = anchor.findRenderObject() as RenderBox;
    final overlay = Overlay.of(anchor).context.findRenderObject() as RenderBox;
    final pos = RelativeRect.fromRect(
      Rect.fromPoints(box.localToGlobal(Offset(0, box.size.height), ancestor: overlay),
          box.localToGlobal(box.size.bottomRight(Offset.zero), ancestor: overlay)),
      Offset.zero & overlay.size,
    );
    final choice = await showMenu<String>(context: anchor, position: pos, items: const [
      PopupMenuItem(value: 'update', child: Text('Post an update')),
      PopupMenuItem(value: 'delay', child: Text('Report a delay')),
    ]);
    if (choice == 'update') updateSheet();
    if (choice == 'delay') delaySheet();
  }

  /* --------------------------------------------------------------- view */

  @override
  Widget build(BuildContext context) {
    return V2Scope(
      child: Builder(builder: (context) {
        final c = context.v;
        final j = job;
        return Scaffold(
          backgroundColor: c.bg,
          body: Column(children: [
            BackTop(
              j?['jobOrderNo'] as String? ?? 'Job',
              trailing: j == null ? null : _topRight(j),
            ),
            Expanded(
              child: loading
                  ? Center(child: CircularProgressIndicator(color: c.ac))
                  : error != null
                      ? MBody(children: [
                          Note.text(error!, icon: V2Icons.alert),
                          V2Button('Try again', block: true, onPressed: load),
                        ])
                      : _body(j!),
            ),
          ]),
          bottomNavigationBar: j == null || loading ? null : _bar(j),
        );
      }),
    );
  }

  Widget? _topRight(Map j) {
    if (awaitingMyAnswer(j)) return Meta(timeAgoShort(j['updatedAt'] as String? ?? j['createdAt'] as String));
    if (j['status'] == 'IN_PROGRESS') {
      return Builder(
        builder: (b) => V2IconButton(V2Icons.dots, tooltip: 'More: report a delay', plain: true, onPressed: () => _moreMenu(b)),
      );
    }
    return null;
  }

  Widget _body(Map<String, dynamic> j) {
    final c = context.v;
    final r = j['report'] as Map;
    final status = j['status'] as String;
    final offer = awaitingMyAnswer(j);
    final delay = openDelay(j);
    final photos = r['photos'] as List? ?? const [];
    final photoUrl = photos.isEmpty ? null : AppConfig.mediaUrl(photos.first['storageUrl']);

    return MBody(
      top: 0,
      bottom: 24,
      onRefresh: load,
      children: [
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            PriorityLabel(r['priority'] as String?),
            const SizedBox(width: 8),
            Flexible(child: jobStatus(j)),
          ]),
          const SizedBox(height: 8),
          H1(r['category']['name'] as String, size: 22),
        ]),
        if (status == 'DELAYED' && delay != null) _pausedNote(delay),
        MCard(
          child: Column(children: [
            FactLine(V2Icons.pin, placeText(r['location'] as Map)),
            FactLine(V2Icons.user, _reporterText(r)),
            FactLine(V2Icons.calendar, _targetText(j, delay)),
            if (_impactText(r) != null) FactLine(V2Icons.warning, _impactText(r)!),
            FactLine(V2Icons.box,
                (j['materialsNote'] as String?)?.isNotEmpty == true ? 'Materials: ${j['materialsNote']}' : 'No materials listed'),
          ]),
        ),
        MCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Sub(r['description'] as String),
            const SizedBox(height: 12),
            PhotoBox(url: photoUrl, height: status == 'ASSIGNED' ? 150 : 160, label: "Reporter's photo"),
          ]),
        ),
        if (offer)
          Note.text(
              'The GSO offered this job to you. Accept to add it to My jobs, or decline with a reason so it can go to someone else.')
        else if (status == 'ASSIGNED') ...[
          V2Field('Note to the GSO (optional)',
              child: V2Input(controller: note, hint: 'Example: checking the motor first')),
          MCard(
            color: c.ambs,
            borderColor: Colors.transparent,
            padding: const EdgeInsets.fromLTRB(16, 10, 10, 10),
            onTap: delaySheet,
            child: Row(children: [
              V2Icon(V2Icons.box, size: 20, color: c.amb),
              const SizedBox(width: 12),
              Expanded(child: Text('Waiting on materials?', style: v2Text(size: 14.5, weight: FontWeight.w700, color: c.tx))),
              V2Button('Report a delay', size: BtnSize.sm, onPressed: delaySheet),
            ]),
          ),
        ],
        if (!offer && status != 'ASSIGNED' && _updates(j).isNotEmpty)
          MCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const H2('Your updates'),
              const SizedBox(height: 10),
              V2Timeline(_updates(j)),
            ]),
          ),
        if (status == 'COMPLETED')
          Note.text('You finished this job. The GSO checks your photo before closing the report.', icon: V2Icons.info),
        if (status == 'CLOSED') Note.text('The GSO verified the work and closed this job.', icon: V2Icons.check),
        if (status == 'CANCELLED')
          Note.text(
              'This was the same problem as another report, so the work continues under '
              '${j['mergedInto']?['jobOrderNo'] ?? 'another job order'}. No work needed here.',
              icon: V2Icons.info),
      ],
    );
  }

  Widget _pausedNote(Map d) {
    final c = context.v;
    final since = shortLocalDay(d['createdAt']);
    final parts = <String>[
      if ((d['materialsNote'] as String?)?.isNotEmpty == true) '${d['materialsNote']}.',
      if (d['revisedTargetDate'] != null) 'New target date ${shortDay(d['revisedTargetDate'])}.',
      'The reporter has been told.',
    ];
    return Note(
      warn: true,
      icon: V2Icons.clock,
      child: Text.rich(TextSpan(children: [
        TextSpan(text: 'Paused since $since. ', style: v2Text(size: 13.5, weight: FontWeight.w700, color: c.tx)),
        TextSpan(text: parts.join(' ')),
      ])),
    );
  }

  String _reporterText(Map r) {
    final who = r['reporter'] as Map?;
    final type = (who?['userType'] as String?)?.toLowerCase();
    return 'Reported by ${who?['fullName'] ?? 'someone'}${type == null || type.isEmpty ? '' : ' · $type'}';
  }

  String _targetText(Map j, Map? delay) {
    if (delay?['revisedTargetDate'] != null) return 'Target date ${shortDay(delay!['revisedTargetDate'])} (revised)';
    final t = j['targetDate'];
    if (t == null) return 'No target date yet';
    final left = daysUntil(t);
    final rest = !['ASSIGNED', 'IN_PROGRESS', 'DELAYED'].contains(j['status']) || left == null
        ? ''
        : left > 1
            ? ' · $left days left'
            : left == 1
                ? ' · 1 day left'
                : left == 0
                    ? ' · due today'
                    : ' · ${-left} day${left == -1 ? '' : 's'} overdue';
    return 'Target date ${shortDay(t)}$rest';
  }

  String? _impactText(Map r) {
    const people = ['Only the reporter affected', '2–10 people affected', '11–50 people affected', 'More than 50 people affected'];
    final a = (r['affectedPeople'] as num?)?.toInt();
    final parts = [
      if (r['safetyHazard'] == true) 'Safety hazard',
      if (a != null && a >= 1 && a < people.length) people[a],
      if (r['blocksUse'] == true) "Area can't be used",
    ];
    return parts.isEmpty ? null : parts.join(' · ');
  }

  // the job's work history, newest first
  List<TimelineEntry> _updates(Map j) {
    final c = context.v;
    final logs = (j['report']['logs'] as List? ?? const []).cast<Map>();
    final out = <TimelineEntry>[];
    for (final l in logs) {
      final from = l['oldStatus'];
      final to = l['newStatus'];
      String? title;
      Color dot = c.amb;
      if (from == 'ASSIGNED' && to == 'IN_PROGRESS') {
        title = 'Started';
        dot = c.acf;
      } else if (from == 'IN_PROGRESS' && to == 'IN_PROGRESS') {
        title = 'Update';
      } else if (to == 'DELAYED' && from != 'DELAYED') {
        title = 'Paused';
      } else if (from == 'DELAYED' && to == 'IN_PROGRESS') {
        title = 'Resumed';
        dot = c.acf;
      } else if (to == 'COMPLETED' && from != 'COMPLETED') {
        title = 'Finished';
        dot = c.vio;
      } else if (from == 'COMPLETED' && to == 'IN_PROGRESS') {
        title = 'Sent back for rework';
        dot = c.red;
      } else if (to == 'CLOSED' && from != 'CLOSED') {
        title = 'Verified and closed';
        dot = c.ac;
      }
      if (title == null) continue;
      final url = AppConfig.mediaUrl(l['photoUrl']);
      out.add(TimelineEntry(
        title,
        relativeDay(l['createdAt']),
        text: l['remarks'] as String?,
        dot: dot,
        extra: url == null
            ? null
            : Padding(padding: const EdgeInsets.only(top: 8), child: PhotoBox(url: url, width: 120, height: 90)),
      ));
    }
    return out.reversed.toList();
  }

  Widget? _bar(Map<String, dynamic> j) {
    final status = j['status'];
    if (awaitingMyAnswer(j)) {
      return StickyBar(children: [
        Expanded(child: V2Button('Decline', size: BtnSize.lg, block: true, onPressed: busy ? null : declineSheet)),
        Expanded(
          flex: 2,
          child: V2Button('Accept job',
              icon: V2Icons.check, kind: BtnKind.pri, size: BtnSize.lg, block: true, busy: busy, onPressed: accept),
        ),
      ]);
    }
    switch (status) {
      case 'ASSIGNED':
        return StickyBar(children: [
          Expanded(
            child: V2Button('Start work',
                icon: V2Icons.bolt, kind: BtnKind.pri, size: BtnSize.lg, block: true, busy: busy, onPressed: startWork),
          ),
        ]);
      case 'IN_PROGRESS':
        return StickyBar(children: [
          Expanded(
            flex: 10,
            child: V2Button('Update', icon: V2Icons.pencil, size: BtnSize.lg, block: true, onPressed: busy ? null : updateSheet),
          ),
          Expanded(
            flex: 14,
            child: V2Button('Finish job',
                icon: V2Icons.check, kind: BtnKind.pri, size: BtnSize.lg, block: true, onPressed: busy ? null : finishSheet),
          ),
        ]);
      case 'DELAYED':
        return StickyBar(children: [
          Expanded(
            child: V2Button('Resume Work',
                icon: V2Icons.bolt, kind: BtnKind.pri, size: BtnSize.lg, block: true, busy: busy, onPressed: resume),
          ),
        ]);
      default:
        return null;
    }
  }
}

/// "12 min ago", "3 h ago", "yesterday" or "Nov 24".
String timeAgoShort(String iso) {
  final d = DateTime.tryParse(iso)?.toLocal();
  if (d == null) return '';
  final diff = DateTime.now().difference(d);
  if (diff.inMinutes < 1) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
  if (diff.inHours < 24) return '${diff.inHours} h ago';
  if (diff.inDays == 1) return 'yesterday';
  if (diff.inDays < 7) return '${diff.inDays} days ago';
  return shortLocalDay(iso);
}
