import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/realtime.dart';
import '../../core/ui.dart' show isOverdue, priorityRank;
import '../auth/auth_provider.dart';
import '../notifications/notifications.dart';
import 'tech_history.dart';
import 'tech_job_screen.dart';
import 'tech_notifications.dart';
import 'tech_profile.dart';
import 'tech_stats.dart';
import 'v2.dart';

const _active = {'ASSIGNED', 'IN_PROGRESS', 'DELAYED'};

/// The technician app: Home (jobs), History, My Stats and Profile, with the
/// bottom navigation of the v2 design.
class TechShell extends StatefulWidget {
  const TechShell({super.key});

  @override
  State<TechShell> createState() => _TechShellState();
}

class _TechShellState extends State<TechShell> {
  int tab = 0;
  // tabs are built the first time they are opened, then kept
  final Set<int> opened = {0};
  List<Map<String, dynamic>> jobs = [];
  bool loading = true;
  String? error;
  StreamSubscription<Map<String, dynamic>>? _sub;

  @override
  void initState() {
    super.initState();
    load();
    _sub = Realtime.instance.events.listen((e) {
      if (!mounted) return;
      final me = context.read<AuthProvider>().user?.id;
      if (e['technicianId'] == me && e['kind'] == 'assignment.withdrawn') {
        v2Snack(context, e['message'] as String? ?? 'A job was given to someone else.');
      }
      load(silent: true);
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
      final res = await ApiClient.instance.dio.get('/job-orders/assigned');
      jobs = List<Map<String, dynamic>>.from((res.data as List).map((e) => Map<String, dynamic>.from(e)));
      error = null;
    } catch (e) {
      if (!silent) error = errorMessage(e);
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> openJob(String id) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => TechJobScreen(jobId: id)));
    load(silent: true);
  }

  void go(int i) => setState(() {
        tab = i;
        opened.add(i);
      });

  @override
  Widget build(BuildContext context) {
    final hasOffer = jobs.any(awaitingMyAnswer);
    final pages = <Widget>[
      _HomeTab(
        jobs: jobs.where((j) => _active.contains(j['status'])).toList(),
        loading: loading,
        error: error,
        onRefresh: load,
        onOpen: openJob,
        onProfile: () => go(3),
      ),
      opened.contains(1) ? const TechHistoryTab() : const SizedBox.shrink(),
      opened.contains(2) ? const TechStatsTab() : const SizedBox.shrink(),
      opened.contains(3) ? const TechProfileTab() : const SizedBox.shrink(),
    ];
    return V2Scope(
      child: Builder(
        builder: (context) => Scaffold(
          backgroundColor: context.v.bg,
          body: IndexedStack(index: tab, children: pages),
          bottomNavigationBar: V2BottomNav(
            index: tab,
            onTap: go,
            items: [
              BottomNavItem(V2Icons.inbox, 'Job', dot: hasOffer),
              const BottomNavItem(V2Icons.clock, 'History'),
              const BottomNavItem(V2Icons.chart, 'My Stats'),
              const BottomNavItem(V2Icons.user, 'Profile'),
            ],
          ),
        ),
      ),
    );
  }
}

class _HomeTab extends StatelessWidget {
  final List<Map<String, dynamic>> jobs;
  final bool loading;
  final String? error;
  final Future<void> Function({bool silent}) onRefresh;
  final ValueChanged<String> onOpen;
  final VoidCallback onProfile;
  const _HomeTab({
    required this.jobs,
    required this.loading,
    required this.error,
    required this.onRefresh,
    required this.onOpen,
    required this.onProfile,
  });

  // offers first, then overdue, most urgent, nearest target date
  static int _order(Map a, Map b) {
    final n = (awaitingMyAnswer(b) ? 1 : 0) - (awaitingMyAnswer(a) ? 1 : 0);
    if (n != 0) return n;
    final o = (isOverdue(b) ? 1 : 0) - (isOverdue(a) ? 1 : 0);
    if (o != 0) return o;
    final p = (priorityRank[a['report']['priority']] ?? 9).compareTo(priorityRank[b['report']['priority']] ?? 9);
    if (p != 0) return p;
    final ta = a['targetDate'] as String?;
    final tb = b['targetDate'] as String?;
    if (ta != null && tb != null) return ta.compareTo(tb);
    if (ta != null) return -1;
    if (tb != null) return 1;
    return (a['createdAt'] as String).compareTo(b['createdAt'] as String);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    final user = context.watch<AuthProvider>().user;
    final unread = context.watch<NotificationsController>().unread;
    final sorted = [...jobs]..sort(_order);
    final fresh = sorted.where(awaitingMyAnswer).length;
    final active = sorted.length - fresh;

    return Column(children: [
      MTop(
        padding: const EdgeInsets.fromLTRB(20, 24, 20, 14),
        children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Meta(longToday(), size: 13),
              const H1('Home', size: 24),
            ]),
          ),
          V2IconButton(
            V2Icons.bell,
            tooltip: unread > 0 ? 'Notifications, $unread unread' : 'Notifications',
            onPressed: () =>
                Navigator.push(context, MaterialPageRoute(builder: (_) => const TechNotificationsScreen())),
            badge: unread > 0 ? CountBadge(unread, hot: true, height: 18, fontSize: 10.5) : null,
          ),
          Semantics(
            button: true,
            label: 'Profile',
            child: GestureDetector(onTap: onProfile, child: Avatar(user?.fullName ?? '', size: 41)),
          ),
        ],
      ),
      Expanded(
        child: MBody(
          top: 4,
          onRefresh: onRefresh,
          children: [
            Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
              const Expanded(child: H2('My jobs')),
              if (!loading && error == null) Meta('$fresh New · $active Active'),
            ]),
            if (loading)
              Padding(
                padding: const EdgeInsets.all(32),
                child: Center(child: CircularProgressIndicator(color: c.ac)),
              )
            else if (error != null) ...[
              Note.text(error!, icon: V2Icons.alert),
              V2Button('Try again', block: true, onPressed: onRefresh),
            ] else if (sorted.isEmpty)
              Note.text('No jobs right now. New jobs from the GSO appear here.', icon: V2Icons.info)
            else
              for (final j in sorted) _JobCard(job: j, onOpen: () => onOpen(j['id'] as String)),
          ],
        ),
      ),
    ]);
  }
}

class _JobCard extends StatelessWidget {
  final Map<String, dynamic> job;
  final VoidCallback onOpen;
  const _JobCard({required this.job, required this.onOpen});

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    final r = job['report'] as Map;
    final loc = r['location'] as Map;
    final fresh = awaitingMyAnswer(job);
    final overdue = isOverdue(job);
    final due = job['targetDate'] == null ? null : 'Due ${shortDay(job['targetDate'])}';
    final where = [loc['building'], loc['room']].where((x) => x != null && '$x'.isNotEmpty).join(' · ');

    return MCard(
      borderColor: fresh ? c.acl : null,
      onTap: onOpen,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          IconSquare.trade(job['tradeUnit']?['name'] as String?),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(r['category']['name'] as String,
                  style: v2Text(size: 15, weight: FontWeight.w700, color: c.tx, height: 1.35)),
              Meta([where, ?due].join(' · ')),
            ]),
          ),
          const SizedBox(width: 8),
          PriorityLabel(r['priority'] as String?),
        ]),
        const SizedBox(height: 10),
        Row(children: [
          Flexible(child: jobStatus(job, long: false)),
          const Spacer(),
          if (fresh)
            Meta(timeAgoShort(job['updatedAt'] as String? ?? job['createdAt'] as String))
          else if (overdue)
            const V2Tag('Overdue', tone: TagTone.bad),
        ]),
        const SizedBox(height: 14),
        V2Button('Open Job', kind: BtnKind.pri, block: true, onPressed: onOpen),
      ]),
    );
  }
}
