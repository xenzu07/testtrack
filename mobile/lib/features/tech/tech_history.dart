import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import 'tech_job_screen.dart';
import 'v2.dart';

String _ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// Jobs that are finished, waiting for the GSO check, declined or given to
/// someone else, newest first and grouped by month.
class TechHistoryTab extends StatefulWidget {
  const TechHistoryTab({super.key});

  @override
  State<TechHistoryTab> createState() => _TechHistoryTabState();
}

enum _Filter { all, closed, declined }

class _TechHistoryTabState extends State<TechHistoryTab> {
  List<Map<String, dynamic>> items = [];
  bool loading = true;
  String? error;
  _Filter filter = _Filter.all;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() {
      loading = items.isEmpty;
      error = null;
    });
    try {
      final now = DateTime.now();
      final res = await ApiClient.instance.dio.get('/analytics/me', queryParameters: {
        'from': _ymd(now.subtract(const Duration(days: 365))),
        'to': _ymd(now),
      });
      final history = List<Map<String, dynamic>>.from(
          (res.data['history'] as List).map((e) => Map<String, dynamic>.from(e)));
      // still on the Home tab: new offers and jobs being worked on
      items = history.where((h) {
        if (h['status'] == 'PENDING') return false;
        if (h['status'] == 'ACCEPTED') {
          return const {'COMPLETED', 'CLOSED', 'CANCELLED'}.contains(h['jobOrder']['status']);
        }
        return true;
      }).toList();
    } catch (e) {
      error = errorMessage(e);
    }
    if (mounted) setState(() => loading = false);
  }

  bool _closed(Map h) => h['status'] == 'ACCEPTED' && h['jobOrder']['status'] == 'CLOSED';
  bool _declined(Map h) => h['status'] == 'DECLINED';

  DateTime _when(Map h) =>
      DateTime.tryParse('${h['completedAt'] ?? h['respondedAt'] ?? h['assignedAt']}')?.toLocal() ?? DateTime.now();

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    final shown = items
        .where((h) => switch (filter) {
              _Filter.all => true,
              _Filter.closed => _closed(h),
              _Filter.declined => _declined(h),
            })
        .toList()
      ..sort((a, b) => _when(b).compareTo(_when(a)));

    // month groups, newest first
    final groups = <String, List<Map<String, dynamic>>>{};
    final now = DateTime.now();
    for (final h in shown) {
      final d = _when(h);
      final key = d.year == now.year ? monthName(d.month) : '${monthName(d.month)} ${d.year}';
      groups.putIfAbsent(key, () => []).add(h);
    }

    return Column(children: [
      const MTop(padding: EdgeInsets.fromLTRB(20, 24, 20, 14), children: [Expanded(child: H1('History', size: 24))]),
      Expanded(
        child: MBody(
          onRefresh: load,
          children: [
            Seg<_Filter>(
              selected: filter,
              onChanged: (f) => setState(() => filter = f),
              options: [
                (_Filter.all, 'All ${items.length}'),
                (_Filter.closed, 'Closed ${items.where(_closed).length}'),
                (_Filter.declined, 'Declined ${items.where(_declined).length}'),
              ],
            ),
            if (loading)
              Padding(padding: const EdgeInsets.all(32), child: Center(child: CircularProgressIndicator(color: c.ac)))
            else if (error != null) ...[
              Note.text(error!, icon: V2Icons.alert),
              V2Button('Try again', block: true, onPressed: load),
            ] else if (shown.isEmpty)
              Note.text(
                filter == _Filter.declined
                    ? 'Jobs you decline appear here.'
                    : 'Finished jobs appear here once you mark them as done.',
                icon: V2Icons.info,
              )
            else
              for (final g in groups.entries) ...[
                Padding(padding: const EdgeInsets.only(top: 4), child: H2(g.key)),
                CardRows([for (final h in g.value) _row(h)]),
              ],
          ],
        ),
      ),
    ]);
  }

  Widget _row(Map<String, dynamic> h) {
    final c = context.v;
    final jo = h['jobOrder'] as Map;
    final r = jo['report'] as Map;
    final loc = r['location'] as Map? ?? const {};
    final where = [loc['building'], loc['room']].where((x) => x != null && '$x'.isNotEmpty).join(' · ');
    final accepted = h['status'] == 'ACCEPTED';
    final hours = h['hoursToComplete'] as num?;

    final String when;
    final Widget status;
    if (h['status'] == 'DECLINED') {
      when = 'Offered ${shortLocalDay(h['assignedAt'])}';
      status = const V2Tag('Declined', tone: TagTone.bad);
    } else if (h['status'] == 'CANCELLED') {
      when = 'Offered ${shortLocalDay(h['assignedAt'])}';
      status = const V2Tag('Reassigned');
    } else if (jo['status'] == 'CANCELLED') {
      when = 'Merged with another job';
      status = const V2Tag('Merged');
    } else {
      final done = h['completedAt'] ?? h['respondedAt'];
      when = [shortLocalDay(done), if (hours != null) daysText(hours)].join(' · ');
      status = jo['status'] == 'CLOSED' ? const StatusDot('Closed', StKind.done) : const StatusDot('Checking', StKind.check);
    }

    return InkWell(
      onTap: accepted ? () => Navigator.push(context, MaterialPageRoute(builder: (_) => TechJobScreen(jobId: jo['id']))) : null,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(children: [
          IconSquare.trade(jo['tradeUnit']?['name'] as String?),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(r['category']['name'] as String, style: v2Text(size: 14.5, weight: FontWeight.w700, color: c.tx, height: 1.35)),
              if (where.isNotEmpty) Meta(where),
              Meta(when),
            ]),
          ),
          const SizedBox(width: 8),
          status,
        ]),
      ),
    );
  }
}
