import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import 'v2.dart';

String _ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
const _wd = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/// The technician's own numbers, computed by the server from their job
/// records (the same numbers coordinators see).
class TechStatsTab extends StatefulWidget {
  const TechStatsTab({super.key});

  @override
  State<TechStatsTab> createState() => _TechStatsTabState();
}

class _TechStatsTabState extends State<TechStatsTab> {
  int days = 30;
  Map<String, dynamic>? data;
  int? previous; // jobs fixed in the period before, for the comparison
  bool loading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<Map<String, dynamic>> _fetch(DateTime from, DateTime to) async {
    final res = await ApiClient.instance.dio.get('/analytics/me', queryParameters: {'from': _ymd(from), 'to': _ymd(to)});
    return Map<String, dynamic>.from(res.data);
  }

  Future<void> load() async {
    setState(() {
      loading = data == null;
      error = null;
    });
    try {
      final now = DateTime.now();
      final from = now.subtract(Duration(days: days - 1));
      final results = await Future.wait([
        _fetch(from, now),
        _fetch(from.subtract(Duration(days: days)), from.subtract(const Duration(days: 1))),
      ]);
      data = results[0];
      previous = (results[1]['jobs']['completed'] as num).toInt();
    } catch (e) {
      error = errorMessage(e);
    }
    if (mounted) setState(() => loading = false);
  }

  String get _periodWord => switch (days) { 7 => 'last week', 30 => 'last month', _ => 'the 90 days before' };

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    return Column(children: [
      const MTop(padding: EdgeInsets.fromLTRB(20, 24, 20, 14), children: [Expanded(child: H1('My stats', size: 24))]),
      Expanded(
        child: MBody(
          onRefresh: load,
          children: [
            Seg<int>(
              selected: days,
              onChanged: (d) {
                setState(() => days = d);
                load();
              },
              options: const [(7, '7 days'), (30, '30 days'), (90, '90 days')],
            ),
            if (loading)
              Padding(padding: const EdgeInsets.all(32), child: Center(child: CircularProgressIndicator(color: c.ac)))
            else if (error != null) ...[
              Note.text(error!, icon: V2Icons.alert),
              V2Button('Try again', block: true, onPressed: load),
            ] else
              ..._content(),
          ],
        ),
      ),
    ]);
  }

  List<Widget> _content() {
    final c = context.v;
    final d = data!;
    final fixed = (d['jobs']['completed'] as num).toInt();
    final delta = previous == null ? null : fixed - previous!;
    final offers = d['offers'] as Map;
    final answered = (offers['accepted'] as num) + (offers['declined'] as num);
    final median = d['jobs']['completionTime']?['medianHours'] as num?;
    final recent = (d['history'] as List)
        .cast<Map>()
        .where((h) => h['completedAt'] != null && h['status'] == 'ACCEPTED')
        .take(5)
        .toList();

    return [
      MCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Meta('Jobs fixed', weight: FontWeight.w600),
          Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
            Text('$fixed', style: v2Text(size: 40, weight: FontWeight.w800, spacing: -1, color: c.tx, height: 1.2)),
            const SizedBox(width: 10),
            if (delta != null)
              Meta(
                delta == 0 ? 'same as $_periodWord' : '${delta > 0 ? '+' : ''}$delta vs $_periodWord',
                color: delta >= 0 ? c.ac : c.red,
              ),
          ]),
          const SizedBox(height: 8),
          _bars(d),
        ]),
      ),
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          child: _tile(
            'Offers accepted',
            answered == 0 ? '—' : '${((offers['accepted'] as num) / answered * 100).round()}%',
            '${offers['accepted']} of $answered',
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _tile(
            'Median fix time',
            median == null ? '—' : (median < 24 ? '${median.toStringAsFixed(1)} h' : daysText(median)),
            'from accepting',
          ),
        ),
      ]),
      if (recent.isNotEmpty)
        MCard(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          child: Column(children: [
            for (var i = 0; i < recent.length; i++)
              Container(
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(border: i == 0 ? null : Border(top: BorderSide(color: c.line))),
                child: Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(_title(recent[i]), style: v2Text(size: 14, weight: FontWeight.w700, color: c.tx, height: 1.35)),
                      Meta([
                        shortLocalDay(recent[i]['completedAt']),
                        if (recent[i]['hoursToComplete'] != null) daysText(recent[i]['hoursToComplete'] as num),
                      ].join(' · ')),
                    ]),
                  ),
                  recent[i]['jobOrder']['status'] == 'CLOSED'
                      ? const StatusDot('Closed', StKind.done)
                      : const StatusDot('Checking', StKind.check),
                ]),
              ),
          ]),
        ),
    ];
  }

  String _title(Map h) {
    final r = h['jobOrder']['report'] as Map;
    final room = r['location']?['room'] as String?;
    return [r['category']['name'], if (room != null && room.isNotEmpty) room].join(' · ');
  }

  Widget _tile(String label, String value, String sub) => MCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Meta(label, weight: FontWeight.w600),
          Text(value, style: v2Text(size: 24, weight: FontWeight.w800, color: context.v.tx, height: 1.4)),
          Meta(sub),
        ]),
      );

  // seven columns: the period split into seven equal parts
  Widget _bars(Map d) {
    final c = context.v;
    final keys = List<String>.from(d['series']['keys'] as List);
    final values = List<int>.from((d['series']['completed'] as List).map((e) => (e as num).toInt()));
    final g = d['range']['granularity'] as String;
    final n = keys.length;
    final groups = <(String, int)>[];
    final count = n < 7 ? n : 7;
    for (var i = 0; i < count; i++) {
      final start = (i * n / count).floor();
      final end = ((i + 1) * n / count).floor();
      var sum = 0;
      for (var k = start; k < end; k++) {
        sum += values[k];
      }
      final day = DateTime.tryParse(keys[start]);
      final label = day == null
          ? ''
          : (g == 'day' && n <= 7)
              ? _wd[day.weekday - 1]
              : shortDay('${keys[start]}T00:00:00Z');
      groups.add((label, sum));
    }
    final top = groups.fold<int>(0, (a, b) => b.$2 > a ? b.$2 : a);

    return Semantics(
      label: 'Jobs fixed over the period: ${groups.map((g) => '${g.$1} ${g.$2}').join(', ')}',
      child: SizedBox(
        height: 140,
        child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          for (var i = 0; i < groups.length; i++) ...[
            if (i > 0) const SizedBox(width: 6),
            Expanded(
              // the bar takes whatever height is left after the two labels,
              // so the column never overflows, whatever the text size
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                _fit('${groups[i].$2}'),
                const SizedBox(height: 6),
                Expanded(
                  child: Align(
                    alignment: Alignment.bottomCenter,
                    child: FractionallySizedBox(
                      heightFactor: top == 0 ? 0 : groups[i].$2 / top,
                      widthFactor: 1,
                      child: Container(
                        decoration: BoxDecoration(color: c.acf, borderRadius: BorderRadius.circular(6)),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                _fit(groups[i].$1),
              ]),
            ),
          ],
        ]),
      ),
    );
  }

  // a chart label that shrinks to fit its column instead of colliding with
  // the next one ("Nov 14" next to "Nov 18" on a narrow phone)
  Widget _fit(String text) => FittedBox(
        fit: BoxFit.scaleDown,
        child: Text(text, maxLines: 1, style: v2Text(size: 11, color: context.v.tx3)),
      );
}
