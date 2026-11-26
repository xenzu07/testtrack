import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import '../../core/config.dart';
import '../../core/realtime.dart';
import '../tech/tech_job_screen.dart' show timeAgoShort;
import '../tech/v2.dart';
import 'rep_common.dart';
import 'rep_form.dart';

const _steps = ['Sent', 'Routed', 'Assigned', 'Fixing', 'Done', 'Checked'];

int _stepOf(String s) => switch (s) {
      'SUBMITTED' => 0,
      'UNDER_REVIEW' => 1,
      'ASSIGNED' => 2,
      'IN_PROGRESS' || 'DELAYED' => 3,
      'COMPLETED' => 4,
      'CLOSED' => 5,
      _ => 0,
    };

class RepReportDetailScreen extends StatefulWidget {
  final String reportId;
  /// opens the rating sheet straight away (from "Rate Repair")
  final bool rate;
  const RepReportDetailScreen({super.key, required this.reportId, this.rate = false});

  @override
  State<RepReportDetailScreen> createState() => _RepReportDetailScreenState();
}

class _RepReportDetailScreenState extends State<RepReportDetailScreen> {
  Map<String, dynamic>? report;
  bool loading = true;
  String? error;
  bool _asked = false;
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
      final res = await ApiClient.instance.dio.get('/reports/${widget.reportId}');
      report = Map<String, dynamic>.from(res.data);
      error = null;
    } catch (e) {
      if (!silent) error = errorMessage(e);
    }
    if (mounted) setState(() => loading = false);
    // a verified repair asks for a rating once
    if (mounted && !_asked && report != null && needsRating(report!) && widget.rate) {
      _asked = true;
      WidgetsBinding.instance.addPostFrameCallback((_) => rateSheet());
    }
  }

  Future<void> openForm() async {
    final r = report!;
    final f = r['jobOrderForm'];
    final done = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => f == null || f['status'] == 'RETURNED'
            ? RepFormScreen(reportId: r['id'] as String)
            : RepFormDetailScreen(formId: f['id'] as String),
      ),
    );
    if (done == true || mounted) load(silent: true);
  }

  Future<void> rateSheet() async {
    final r = report!;
    final tech = techName(r);
    final fixed = reachedAt(r, 'COMPLETED');
    const tags = ['Fast', 'Neat work', 'Friendly', 'Still has issues'];
    final chosen = <String>{};
    final comment = TextEditingController();
    var stars = 0;
    var sending = false;
    final sent = await showV2Sheet<bool>(context, (ctx, setSheet) {
      final c = ctx.v;
      return [
        Column(children: [
          Center(
            child: Container(
              height: 24,
              padding: const EdgeInsets.symmetric(horizontal: 10),
              decoration: BoxDecoration(color: c.acs, borderRadius: BorderRadius.circular(999)),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                V2Icon(V2Icons.check, size: 13, color: c.ac),
                const SizedBox(width: 6),
                Text('Verified by the GSO', style: v2Text(size: 12, weight: FontWeight.w600, color: c.ac, height: 1)),
              ]),
            ),
          ),
          const SizedBox(height: 12),
          const H2('How was the repair?', size: 20),
          const SizedBox(height: 2),
          if (tech != null || fixed != null)
            Meta([if (tech != null) '$tech fixed it', if (fixed != null) 'on ${shortLocalDay(fixed)}'].join(' ')),
        ]),
        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          for (var i = 1; i <= 5; i++)
            Semantics(
              button: true,
              label: '$i star${i == 1 ? '' : 's'}',
              selected: stars == i,
              child: GestureDetector(
                onTap: () => setSheet(() => stars = i),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 3),
                  child: V2Icon(V2Icons.star, size: 40, color: i <= stars ? const Color(0xFFF5B82E) : c.line2),
                ),
              ),
            ),
        ]),
        Wrap(alignment: WrapAlignment.center, spacing: 8, runSpacing: 8, children: [
          for (final t in tags)
            V2Chip(t, on: chosen.contains(t), onTap: () => setSheet(() => chosen.contains(t) ? chosen.remove(t) : chosen.add(t))),
        ]),
        V2Input(controller: comment, multiline: true, minHeight: 72, maxLength: 400, hint: 'Anything else? (optional)'),
        V2Button(
          'Send rating',
          kind: BtnKind.pri,
          size: BtnSize.lg,
          block: true,
          busy: sending,
          onPressed: stars == 0
              ? null
              : () async {
                  setSheet(() => sending = true);
                  final text = [
                    if (chosen.isNotEmpty) '${chosen.join(', ')}.',
                    if (comment.text.trim().isNotEmpty) comment.text.trim(),
                  ].join(' ');
                  try {
                    await ApiClient.instance.dio.post('/reports/${r['id']}/feedback', data: {
                      'rating': stars,
                      if (text.isNotEmpty) 'comment': text,
                    });
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
          child: V2Button('Not now', kind: BtnKind.ghost, block: true, onPressed: () => Navigator.pop(ctx)),
        ),
      ];
    }, onDispose: comment.dispose);
    if (sent == true && mounted) {
      v2Snack(context, 'Thanks for rating the repair.');
      load(silent: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return V2Scope(
      child: Builder(builder: (context) {
        final c = context.v;
        return Scaffold(
          backgroundColor: c.bg,
          body: Column(children: [
            BackTop('Report',
                trailing: report == null
                    ? null
                    : Builder(
                        builder: (b) => V2IconButton(V2Icons.dots, tooltip: 'More', plain: true, onPressed: () => _more(b)),
                      )),
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

  Future<void> _more(BuildContext anchor) async {
    final r = report!;
    final box = anchor.findRenderObject() as RenderBox;
    final overlay = Overlay.of(anchor).context.findRenderObject() as RenderBox;
    final pos = RelativeRect.fromRect(
      Rect.fromPoints(box.localToGlobal(Offset(0, box.size.height), ancestor: overlay),
          box.localToGlobal(box.size.bottomRight(Offset.zero), ancestor: overlay)),
      Offset.zero & overlay.size,
    );
    final choice = await showMenu<String>(context: anchor, position: pos, items: [
      if (r['duplicateOfId'] == null && (r['jobOrderForm'] != null || r['status'] != 'CLOSED'))
        const PopupMenuItem(value: 'form', child: Text('Job Order Form')),
      if (needsRating(r)) const PopupMenuItem(value: 'rate', child: Text('Rate the repair')),
      const PopupMenuItem(value: 'refresh', child: Text('Refresh')),
    ]);
    if (choice == 'form') openForm();
    if (choice == 'rate') rateSheet();
    if (choice == 'refresh') load();
  }

  Widget _content() {
    final c = context.v;
    final r = report!;
    final photos = r['photos'] as List? ?? const [];
    final photoUrl = photos.isEmpty ? null : AppConfig.mediaUrl(photos.first['storageUrl']);
    final f = r['jobOrderForm'];
    final linked = r['duplicateOfId'] != null;

    return MBody(bottom: 40, onRefresh: load, children: [
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          PriorityLabel(priorityOf(r)),
          const SizedBox(width: 8),
          Expanded(
            child: Meta('${placeShort(r['location'] as Map?)} · ${timeAgoShort(r['createdAt'] as String)}'),
          ),
        ]),
        const SizedBox(height: 6),
        H1('${r['category']['name']}', size: 22),
      ]),
      _progressCard(r),
      if (linked)
        Note.text(
            'Someone reported the same problem earlier, so this report is handled together with theirs. '
            'You still get every update here.',
            icon: V2Icons.info),
      if (needsRating(r))
        MCard(
          borderColor: c.acl,
          child: Row(children: [
            IconSquare(V2Icons.star, const Color(0xFFD9711A), size: 36, iconSize: 18),
            const SizedBox(width: 12),
            Expanded(child: Text('Fixed and verified. How did it go?', style: v2Text(size: 14, weight: FontWeight.w700, color: c.tx))),
            V2Button('Rate', kind: BtnKind.pri, size: BtnSize.sm, onPressed: rateSheet),
          ]),
        )
      else if (r['feedback'] != null)
        _ratingCard(r['feedback'] as Map),
      if (!linked && (f != null || r['status'] != 'CLOSED')) _formCard(r),
      MCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const H2('Updates'),
          const SizedBox(height: 10),
          V2Timeline(_updates(r)),
        ]),
      ),
      MCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const H2('What you reported'),
          const SizedBox(height: 10),
          PhotoBox(url: photoUrl, height: 150, label: 'Your photo'),
          const SizedBox(height: 10),
          Sub('${r['description']}'),
        ]),
      ),
    ]);
  }

  Widget _progressCard(Map r) {
    final c = context.v;
    final status = r['status'] as String;
    final job = activeJob(r);
    final tech = techName(r);
    final first = tech?.split(' ').first;
    final trade = (r['proposedTradeUnit'] as Map?)?['name'] as String?;
    final target = job?['targetDate'];
    final meta = [?trade, if (target != null) 'target ${shortDay(target)}'].join(' · ');
    final headline = switch (status) {
      'SUBMITTED' => 'Sent to the GSO',
      'UNDER_REVIEW' => 'The GSO is reviewing it',
      'ASSIGNED' => first != null ? '$first will fix it' : 'Waiting for a technician',
      'IN_PROGRESS' => first != null ? '$first is fixing it' : 'Being fixed',
      'DELAYED' => 'Paused for now',
      'COMPLETED' => first != null ? '$first finished · the GSO is checking' : 'Finished · the GSO is checking',
      'CLOSED' => 'Fixed and verified',
      _ => statusText(status),
    };
    final step = _stepOf(status);
    final allDone = status == 'CLOSED';

    return MCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          tech != null
              ? Avatar(tech, size: 44)
              : IconSquare(status == 'CLOSED' ? V2Icons.check : V2Icons.clock,
                  status == 'CLOSED' ? c.acf : const Color(0xFF4F6258),
                  size: 44, radius: 22),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(headline, style: v2Text(size: 15, weight: FontWeight.w700, color: c.tx, height: 1.35)),
              if (status == 'DELAYED')
                Meta(_pausedWhy(r))
              else if (meta.isNotEmpty)
                Meta(meta),
            ]),
          ),
        ]),
        const SizedBox(height: 14),
        Row(children: [
          for (var i = 0; i < _steps.length; i++) ...[
            if (i > 0) const SizedBox(width: 6),
            Expanded(
              child: Container(
                height: 6,
                decoration: BoxDecoration(
                  color: allDone || i < step ? c.acf : (i == step ? c.ac : c.s3),
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
            ),
          ],
        ]),
        const SizedBox(height: 8),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          for (var i = 0; i < _steps.length; i++)
            Text(_steps[i],
                style: v2Text(
                    size: 12,
                    weight: i == step ? FontWeight.w700 : FontWeight.w400,
                    color: i == step ? c.tx : c.tx3)),
        ]),
      ]),
    );
  }

  String _pausedWhy(Map r) {
    final logs = (r['logs'] as List? ?? const []).cast<Map>();
    for (final l in logs.reversed) {
      if (l['newStatus'] == 'DELAYED' && (l['remarks'] as String?)?.isNotEmpty == true) return l['remarks'] as String;
    }
    return 'Waiting for materials or another team';
  }

  Widget _formCard(Map r) {
    final c = context.v;
    final f = r['jobOrderForm'] as Map?;
    return MCard(
      borderColor: f == null || f['status'] == 'RETURNED' ? c.acl : null,
      onTap: openForm,
      child: Row(children: [
        IconSquare(V2Icons.pencil, f?['status'] == 'RETURNED' ? const Color(0xFFD6456A) : c.acf, size: 36, iconSize: 18),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(f == null ? 'Job Order Form' : 'Job Order Form · ${f['formNo']}',
                style: v2Text(size: 14, weight: FontWeight.w700, color: c.tx, height: 1.35)),
            Meta(f == null
                ? 'Not signed yet. The GSO needs it before work starts.'
                : f['status'] == 'RETURNED'
                    ? 'Returned: ${f['decisionNote'] ?? 'please change and sign again'}'
                    : (f['revision'] ?? 1) > 1
                        ? 'Signed again ${shortLocalDay(f['submittedAt'])}'
                        : 'Signed when you sent the report'),
          ]),
        ),
        const SizedBox(width: 8),
        f == null ? const V2Tag('Sign', tone: TagTone.warn) : formStatus(f['status'] as String?),
      ]),
    );
  }

  Widget _ratingCard(Map fb) {
    final c = context.v;
    final rating = (fb['rating'] as num?)?.toInt() ?? 0;
    return MCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Expanded(child: H2('Your rating')),
          for (var i = 1; i <= 5; i++)
            V2Icon(V2Icons.star, size: 18, color: i <= rating ? const Color(0xFFF5B82E) : c.line2),
        ]),
        if ((fb['comment'] as String?)?.isNotEmpty == true) ...[
          const SizedBox(height: 6),
          Sub('${fb['comment']}', size: 13.5),
        ],
      ]),
    );
  }

  // the report's history in plain words, newest first
  List<TimelineEntry> _updates(Map r) {
    final c = context.v;
    final logs = (r['logs'] as List? ?? const []).cast<Map>();
    final out = <TimelineEntry>[];
    for (final l in logs) {
      final from = l['oldStatus'];
      final to = l['newStatus'];
      final remarks = l['remarks'] as String?;
      String title;
      Color dot;
      String? text = remarks;
      if (from == null) {
        title = 'Reported';
        dot = c.gry;
        text = 'Thanks for reporting.';
      } else if (to == 'UNDER_REVIEW') {
        title = 'Under review';
        dot = c.gry;
      } else if (to == 'ASSIGNED' && from != 'ASSIGNED') {
        title = 'Assigned';
        dot = c.blu;
      } else if (to == 'ASSIGNED') {
        title = 'Update';
        dot = c.blu;
      } else if (from == 'ASSIGNED' && to == 'IN_PROGRESS') {
        title = 'Work started';
        dot = c.amb;
      } else if (from == 'IN_PROGRESS' && to == 'IN_PROGRESS') {
        title = 'Work update';
        dot = c.amb;
      } else if (to == 'DELAYED') {
        title = 'Paused';
        dot = c.red;
      } else if (from == 'DELAYED' && to == 'IN_PROGRESS') {
        title = 'Work resumed';
        dot = c.amb;
      } else if (to == 'COMPLETED') {
        title = 'Work finished';
        dot = c.vio;
      } else if (from == 'COMPLETED' && to == 'IN_PROGRESS') {
        title = 'More work needed';
        dot = c.red;
      } else if (to == 'CLOSED') {
        title = 'Verified';
        dot = c.acf;
      } else {
        title = statusText(to as String);
        dot = c.gry;
      }
      final url = AppConfig.mediaUrl(l['photoUrl']);
      out.add(TimelineEntry(
        title,
        timeOrDay(l['createdAt']),
        text: text,
        dot: dot,
        extra: url == null
            ? null
            : Padding(padding: const EdgeInsets.only(top: 8), child: PhotoBox(url: url, width: 120, height: 90)),
      ));
    }
    return out.reversed.toList();
  }
}

String statusText(String s) => s.split('_').map((w) => w[0] + w.substring(1).toLowerCase()).join(' ');
