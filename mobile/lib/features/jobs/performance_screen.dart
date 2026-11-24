import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import '../../core/charts.dart';
import '../../core/format.dart';
import '../../core/realtime.dart';

class PerformanceScreen extends StatefulWidget {
  const PerformanceScreen({super.key});

  @override
  State<PerformanceScreen> createState() => _PerformanceScreenState();
}

class _PerformanceScreenState extends State<PerformanceScreen> {
  Map<String, dynamic>? data;
  bool loading = true;
  String? error;
  StreamSubscription<Map<String, dynamic>>? _sub;

  @override
  void initState() {
    super.initState();
    load();
    // a verified or sent-back job changes the numbers
    _sub = Realtime.instance.events.listen((_) {
      if (mounted) load(silent: true);
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
      final res = await ApiClient.instance.dio.get('/analytics/me');
      data = Map<String, dynamic>.from(res.data as Map);
      error = null;
    } catch (e) {
      if (!silent) error = errorMessage(e);
    }
    if (mounted) setState(() => loading = false);
  }

  num? _n(dynamic v) => v is num ? v : null;

  // "2026-11-24" -> "11/24"
  String _weekLabel(String iso) => iso.substring(5).replaceFirst('-', '/');

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My performance'),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: load)],
      ),
      body: _body(),
    );
  }

  Widget _body() {
    if (loading) return const Center(child: CircularProgressIndicator());
    if (error != null || data == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(error ?? 'No data', textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton(onPressed: load, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }

    final s = Map<String, dynamic>.from(data!['summary'] as Map);
    final weekly = List<Map<String, dynamic>>.from(
        (data!['weekly'] as List).map((e) => Map<String, dynamic>.from(e as Map)));
    final cats = List<Map<String, dynamic>>.from(
        (data!['byCategory'] as List).map((e) => Map<String, dynamic>.from(e as Map)));
    final ratings = List<Map<String, dynamic>>.from(
        (data!['ratings'] as List).map((e) => Map<String, dynamic>.from(e as Map)));

    final onTime = _n(s['onTimeRate']);
    final avgRating = _n(s['avgRating']);
    final firstTime = _n(s['firstTimeApprovalRate']);
    final catMax = cats.fold<num>(1, (m, c) => (c['count'] as num) > m ? c['count'] as num : m);
    final ratingMax = ratings.fold<num>(1, (m, c) => (c['count'] as num) > m ? c['count'] as num : m);

    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
            childAspectRatio: 1.55,
            children: [
              KpiTile(
                label: 'Jobs finished',
                value: '${s['finished']}',
                icon: Icons.task_alt,
                color: Colors.green,
                hint: '${s['active']} active, ${s['delayed']} delayed',
              ),
              KpiTile(
                label: 'Avg. time to finish',
                value: formatHours(_n(s['avgCompletionHours'])),
                icon: Icons.timer_outlined,
                color: Colors.indigo,
                hint: 'From job order to done',
              ),
              KpiTile(
                label: 'On-time rate',
                value: onTime == null ? '-' : '${onTime.round()}%',
                icon: Icons.event_available,
                color: Colors.teal,
                hint: '${s['onTimeSample']} job(s) with a target date',
              ),
              KpiTile(
                label: 'Rating',
                value: avgRating == null ? '-' : avgRating.toStringAsFixed(1),
                icon: Icons.star_rounded,
                color: Colors.amber.shade800,
                hint: '${s['ratingCount']} rating(s)',
              ),
              KpiTile(
                label: 'First-time approval',
                value: firstTime == null ? '-' : '${firstTime.round()}%',
                icon: Icons.verified_outlined,
                color: Colors.green.shade700,
                hint: 'Accepted without rework',
              ),
              KpiTile(
                label: 'Sent back for rework',
                value: '${s['reworkCount']}',
                icon: Icons.replay,
                color: Colors.deepOrange,
                hint: 'Times',
              ),
            ],
          ),
          const SizedBox(height: 12),
          SectionCard(
            title: 'Jobs finished per week',
            subtitle: 'Last 8 weeks (week starting Monday)',
            child: ColumnChart(
              labels: [for (final w in weekly) _weekLabel(w['date'] as String)],
              values: [for (final w in weekly) w['count'] as num],
            ),
          ),
          const SizedBox(height: 12),
          SectionCard(
            title: 'What you fix most',
            child: cats.isEmpty
                ? const Text('Finish a job to see this.',
                    style: TextStyle(color: Colors.grey))
                : Column(children: [
                    for (final c in cats)
                      BarRow(
                        label: c['label'] as String,
                        value: c['count'] as num,
                        max: catMax,
                      ),
                  ]),
          ),
          const SizedBox(height: 12),
          SectionCard(
            title: 'Ratings from reporters',
            subtitle: avgRating == null ? 'No ratings yet' : null,
            child: Column(children: [
              if (avgRating != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(children: [
                    StarRow(rating: avgRating, size: 22),
                    const SizedBox(width: 8),
                    Text('${avgRating.toStringAsFixed(1)} / 5'),
                  ]),
                ),
              for (final r in ratings.reversed)
                BarRow(
                  label: '${r['label']} star${r['label'] == '1' ? '' : 's'}',
                  value: r['count'] as num,
                  max: ratingMax,
                  color: Colors.amber.shade700,
                ),
            ]),
          ),
          const SizedBox(height: 8),
          const Text(
            'On time = finished by the target date on the job order. '
            'Ratings come from the reporter after you finish and the coordinator verifies.',
            style: TextStyle(fontSize: 12, color: Colors.grey),
          ),
        ],
      ),
    );
  }
}