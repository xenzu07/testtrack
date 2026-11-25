import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

String _bucket(String key, String g, {bool long = false}) {
  final p = key.split('-').map(int.parse).toList();
  if (g == 'month') return '${_months[p[1] - 1]} ${p[0]}';
  final d = '${_months[p[1] - 1]} ${p[2]}';
  if (!long) return d;
  return g == 'week' ? 'Week of $d' : d;
}

String _hours(num? h) {
  if (h == null) return '—';
  if (h < 1) return '${(h * 60).round().clamp(1, 59)} min';
  if (h < 48) return '${(h * 10).round() / 10} h';
  return '${(h / 24 * 10).round() / 10} days';
}

String _pct(num? r) => r == null ? '—' : '${(r * 100).round()}%';

String _day(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// A technician's own performance, computed by the server from their real
/// job records (the same numbers coordinators see).
class MyPerformanceScreen extends StatefulWidget {
  const MyPerformanceScreen({super.key});

  @override
  State<MyPerformanceScreen> createState() => _MyPerformanceScreenState();
}

class _MyPerformanceScreenState extends State<MyPerformanceScreen> {
  int days = 30;
  Map<String, dynamic>? data;
  bool loading = true;
  bool asList = false;
  String? error;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final now = DateTime.now();
      final res = await ApiClient.instance.dio.get('/analytics/me', queryParameters: {
        'from': _day(now.subtract(Duration(days: days - 1))),
        'to': _day(now),
      });
      data = Map<String, dynamic>.from(res.data);
    } catch (e) {
      error = errorMessage(e);
    }
    if (mounted) setState(() => loading = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My performance')),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? MessageView(icon: Icons.cloud_off, message: error!, actionLabel: 'Retry', onAction: load)
              : RefreshIndicator(onRefresh: load, child: ReadableWidth(child: _content())),
    );
  }

  Widget _tile(String label, String value, String sub, {bool hero = false}) => Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: TextStyle(fontSize: 12, color: context.c.muted)),
            Text(value,
                style: TextStyle(fontSize: hero ? 36 : 24, fontWeight: FontWeight.w700, height: 1.2)),
            Text(sub, style: TextStyle(fontSize: 11, color: context.c.muted)),
          ]),
        ),
      );

  Widget _content() {
    final d = data!;
    final jobs = d['jobs'];
    final offers = d['offers'];
    final s = d['series'];
    final g = d['range']['granularity'] as String;
    final keys = List<String>.from(s['keys']);
    final completed = List<int>.from(s['completed']);
    final accepted = List<int>.from(s['accepted']);
    final history = d['history'] as List;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        SegmentedButton<int>(
          segments: const [
            ButtonSegment(value: 7, label: Text('7 days')),
            ButtonSegment(value: 30, label: Text('30 days')),
            ButtonSegment(value: 90, label: Text('90 days')),
          ],
          selected: {days},
          onSelectionChanged: (v) {
            days = v.first;
            load();
          },
        ),
        const SizedBox(height: 16),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 1.55,
          children: [
            _tile('Jobs completed', '${jobs['completed']}', 'in this period', hero: true),
            _tile('Active now', '${jobs['active']}', 'assigned, in progress or delayed'),
            _tile('Completion rate', _pct(jobs['completionRate']),
                'of ${jobs['acceptedInPeriod']} accepted in this period'),
            _tile('Time to complete', _hours(jobs['completionTime']['avgHours']),
                'average from acceptance'),
            _tile('Jobs offered', '${offers['total']}',
                '${offers['accepted']} accepted · ${offers['declined']} declined'),
            _tile('Median time', _hours(jobs['completionTime']['medianHours']),
                'half of your jobs were faster'),
          ],
        ),
        const SizedBox(height: 20),
        Row(children: [
          Expanded(
            child: Text('Jobs completed per ${g == 'day' ? 'day' : g}',
                style: Theme.of(context).textTheme.titleMedium),
          ),
          TextButton(
            onPressed: () => setState(() => asList = !asList),
            child: Text(asList ? 'Show chart' : 'Show as list'),
          ),
        ]),
        const SizedBox(height: 8),
        if (asList)
          ...[
            for (var i = 0; i < keys.length; i++)
              if (completed[i] > 0 || accepted[i] > 0)
                ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(_bucket(keys[i], g, long: true)),
                  trailing: Text('${completed[i]} completed · ${accepted[i]} accepted'),
                ),
            if (!completed.any((c) => c > 0) && !accepted.any((c) => c > 0))
              Text('No jobs in this period.', style: TextStyle(color: context.c.muted)),
          ]
        else
          _ColumnChart(keys: keys, values: completed, granularity: g),
        const Divider(height: 32),
        Text('Job history', style: Theme.of(context).textTheme.titleMedium),
        SizedBox(height: 4),
        if (history.isEmpty)
          Padding(
            padding: EdgeInsets.all(16),
            child: Text('No jobs yet.', style: TextStyle(color: context.c.muted)),
          ),
        for (final h in history.take(20))
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text('${h['jobOrder']['jobOrderNo']} · ${h['jobOrder']['report']['category']['name']}'),
            subtitle: Text([
              const {
                'ACCEPTED': 'Accepted',
                'DECLINED': 'Declined',
                'PENDING': 'Waiting for your answer',
                'CANCELLED': 'Withdrawn',
              }[h['status']] ?? h['status'],
              if (h['completedAt'] != null) 'completed ${formatDate(h['completedAt'])}',
              if (h['hoursToComplete'] != null) 'took ${_hours(h['hoursToComplete'])}',
            ].join(' · ')),
          ),
      ],
    );
  }
}

/// Single-series column chart: one column per period, value on the tallest
/// column, tap a column for its exact value.
class _ColumnChart extends StatelessWidget {
  final List<String> keys;
  final List<int> values;
  final String granularity;
  const _ColumnChart({required this.keys, required this.values, required this.granularity});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    // reference palette slot 1, light / dark steps
    final color = dark ? const Color(0xFF3987E5) : const Color(0xFF2A78D6);
    final grid = dark ? const Color(0xFF2C2C2A) : const Color(0xFFE1E0D9);
    final maxV = values.fold<int>(0, (a, b) => b > a ? b : a);
    final top = maxV == 0 ? 1 : maxV;
    final maxI = values.indexOf(maxV);
    const h = 140.0;

    return Semantics(
      label: 'Jobs completed per $granularity. Highest: $maxV.',
      child: Column(children: [
        SizedBox(
          height: h + 18,
          child: Container(
            decoration: BoxDecoration(border: Border(bottom: BorderSide(color: grid))),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                for (var i = 0; i < values.length; i++)
                  Expanded(
                    child: Tooltip(
                      triggerMode: TooltipTriggerMode.tap,
                      message: '${_bucket(keys[i], granularity, long: true)}: ${values[i]} completed',
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          if (i == maxI && maxV > 0)
                            Text('$maxV',
                                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
                          Container(
                            height: values[i] == 0 ? 0 : (values[i] / top) * h,
                            constraints: const BoxConstraints(maxWidth: 24),
                            margin: const EdgeInsets.symmetric(horizontal: 1),
                            decoration: BoxDecoration(
                              color: color,
                              borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 4),
        Row(children: [
          Text(_bucket(keys.first, granularity), style: TextStyle(fontSize: 11, color: context.c.muted)),
          const Spacer(),
          Text(_bucket(keys.last, granularity), style: TextStyle(fontSize: 11, color: context.c.muted)),
        ]),
      ]),
    );
  }
}
