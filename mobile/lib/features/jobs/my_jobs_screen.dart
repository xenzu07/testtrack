import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/realtime.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import '../auth/account_menu.dart';
import '../notifications/notifications.dart';
import '../auth/auth_provider.dart';
import 'job_detail_screen.dart';
import 'assignment_sheet.dart';

// offers already shown this session, so "Decide later" is respected
final Set<String> _prompted = {};

class MyJobsScreen extends StatefulWidget {
  const MyJobsScreen({super.key});

  @override
  State<MyJobsScreen> createState() => _MyJobsScreenState();
}

class _MyJobsScreenState extends State<MyJobsScreen> {
  List<dynamic> jobs = [];
  bool loading = true;
  String? error;
  // narrows the Active tab: a status, or 'NEW' for offers awaiting an answer
  String? statusFilter;
  bool _sheetOpen = false;
  StreamSubscription<Map<String, dynamic>>? _sub;

  @override
  void initState() {
    super.initState();
    load().then((_) => _promptNext());
    _sub = Realtime.instance.events.listen((e) async {
      if (!mounted) return;
      final me = context.read<AuthProvider>().user?.id;
      final aboutMe = e['technicianId'] == me;
      if (aboutMe && e['kind'] == 'assignment.withdrawn') {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e['message'] ?? 'A job was reassigned')));
      }
      await load(silent: true);
      // a new job for me: show it right away
      if (aboutMe && e['kind'] == 'assignment.offered') {
        _prompted.remove(e['jobOrderId']);
        _promptNext(jobId: e['jobOrderId'] as String?);
      }
    });
  }

  // shows the accept/decline sheet for the next unanswered offer
  Future<void> _promptNext({String? jobId}) async {
    if (!mounted || _sheetOpen) return;
    final pending = jobs.where((j) => awaitingMyAnswer(j) && !_prompted.contains(j['id']));
    final next = jobId == null
        ? pending.firstOrNull
        : pending.where((j) => j['id'] == jobId).firstOrNull;
    if (next == null) return;
    _prompted.add(next['id'] as String);
    _sheetOpen = true;
    final answered = await showAssignmentSheet(context, Map<String, dynamic>.from(next));
    _sheetOpen = false;
    if (answered && mounted) {
      await load(silent: true);
      _promptNext();
    }
  }

  Future<void> _respond(dynamic j) async {
    _prompted.add(j['id'] as String);
    if (await showAssignmentSheet(context, Map<String, dynamic>.from(j))) {
      load(silent: true);
    }
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
      jobs = List<dynamic>.from(res.data as List);
      error = null;
    } catch (e) {
      if (!silent) error = errorMessage(e);
    }
    if (mounted) setState(() => loading = false);
  }

  // what to do first: offers to answer, overdue, most urgent, nearest target
  int _byPriority(dynamic a, dynamic b) {
    final n = (awaitingMyAnswer(b) ? 1 : 0) - (awaitingMyAnswer(a) ? 1 : 0);
    if (n != 0) return n;
    final o = (isOverdue(b) ? 1 : 0) - (isOverdue(a) ? 1 : 0);
    if (o != 0) return o;
    final p = (priorityRank[a['report']['priority']] ?? 9)
        .compareTo(priorityRank[b['report']['priority']] ?? 9);
    if (p != 0) return p;
    final u = (urgencyRank[a['report']['urgency']] ?? 9)
        .compareTo(urgencyRank[b['report']['urgency']] ?? 9);
    if (u != 0) return u;
    final ta = a['targetDate'] as String?;
    final tb = b['targetDate'] as String?;
    if (ta != null && tb != null) return ta.compareTo(tb);
    if (ta != null) return -1;
    if (tb != null) return 1;
    return (a['createdAt'] as String).compareTo(b['createdAt'] as String);
  }

  Future<void> _open(dynamic j) async {
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => JobDetailScreen(jobId: j['id'])),
    );
    load(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const BrandTitle('My Jobs'),
          toolbarHeight: 64,
          actions: [
            const NotificationBell(),
          const ThemeToggleButton(),
            const AccountMenuButton(),
            const SizedBox(width: 4),
          ],
          bottom: TabBar(tabs: [
            Tab(text: 'Active (${jobs.where((j) => activeJobStatuses.contains(j['status'])).length})'),
            Tab(text: 'History (${jobs.where((j) => !activeJobStatuses.contains(j['status'])).length})'),
          ]),
        ),
        body: _body(),
      ),
    );
  }

  Widget _body() {
    if (loading) return const Center(child: CircularProgressIndicator());
    if (error != null) {
      return MessageView(
          icon: Icons.cloud_off,
          message: error!,
          actionLabel: 'Retry',
          onAction: load);
    }

    final active = jobs.where((j) => activeJobStatuses.contains(j['status'])).toList()
      ..sort(_byPriority);
    final history = jobs.where((j) => !activeJobStatuses.contains(j['status'])).toList()
      ..sort((a, b) => (b['createdAt'] as String).compareTo(a['createdAt'] as String));

    return TabBarView(children: [
      _activeTab(active),
      _list(
        history,
        empty: 'Finished jobs will appear here.',
        header: null,
      ),
    ]);
  }

  Widget _activeTab(List<dynamic> active) {
    final user = context.watch<AuthProvider>().user;
    bool matches(dynamic j, String f) => f == 'NEW'
        ? awaitingMyAnswer(j)
        : j['status'] == f && !awaitingMyAnswer(j);
    int count(String f) => active.where((j) => matches(j, f)).length;
    final overdue = active.where((j) => isOverdue(j)).length;
    final shown = statusFilter == null
        ? active
        : active.where((j) => matches(j, statusFilter!)).toList();

    final header = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (user != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(2, 2, 2, 10),
            child: MetaLine([
              if (user.tradeUnitName != null) TextSpan(text: '${user.tradeUnitName} team'),
              if (user.roles.isNotEmpty) TextSpan(text: 'Roles: ${user.roles.join(', ')}'),
            ]),
          ),
        if (active.isNotEmpty)
        FilterBar<String?>(
          selected: statusFilter,
          onSelected: (f) => setState(() => statusFilter = f),
          options: [
            FilterOption(null, 'All', active.length),
            FilterOption('NEW', 'New', count('NEW'), alert: true),
            FilterOption('ASSIGNED', 'To start', count('ASSIGNED')),
            FilterOption('IN_PROGRESS', 'In progress', count('IN_PROGRESS')),
            FilterOption('DELAYED', 'Delayed', count('DELAYED')),
          ],
        ),
        if (overdue > 0)
          Padding(
            padding: const EdgeInsets.fromLTRB(2, 8, 2, 0),
            child: Text(
              '$overdue job${overdue == 1 ? ' is' : 's are'} past the target date',
              style: TextStyle(color: context.c.danger, fontSize: 13, fontWeight: FontWeight.w500),
            ),
          ),
        const SizedBox(height: 6),
      ],
    );

    return _list(
      shown,
      empty: statusFilter == null
          ? 'New assignments from the coordinator will appear here.'
          : 'No jobs with this status.',
      header: header,
    );
  }

  Widget _list(List<dynamic> list, {required String empty, Widget? header}) {
    return RefreshIndicator(
      onRefresh: load,
      child: ReadableWidth(
        child: ListView(
          padding: const EdgeInsets.all(12),
          children: [
            ?header,
            if (list.isEmpty)
              EmptyState(
                icon: header == null ? Icons.history : Icons.assignment_turned_in_outlined,
                title: header == null ? 'No finished jobs yet' : 'Nothing to work on',
                message: empty,
              ),
            ...list.map((j) => _JobCard(
                job: Map<String, dynamic>.from(j),
                onTap: () => awaitingMyAnswer(j) ? _respond(j) : _open(j))),
          ],
        ),
      ),
    );
  }
}

class _JobCard extends StatelessWidget {
  final Map<String, dynamic> job;
  final VoidCallback onTap;
  const _JobCard({required this.job, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final j = job;
    final r = j['report'];
    final loc = r['location'];
    final overdue = isOverdue(j);
    final isNew = awaitingMyAnswer(j);
    final p = r['priority'] as String?;
    final red = context.c.danger;

    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(
          color: isNew ? Theme.of(context).colorScheme.primary : context.c.border,
          width: isNew ? 1.5 : 1,
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(
                  child: Text(r['category']['name'],
                      style: Theme.of(context).textTheme.titleMedium),
                ),
                const SizedBox(width: 8),
                isNew
                    ? Pill('New offer', Theme.of(context).colorScheme.primary)
                    : StatusChip(j['status']),
              ]),
              const SizedBox(height: 2),
              Text('${loc['building']}, ${loc['floor']}, ${loc['room']}',
                  style: const TextStyle(fontSize: 13)),
              const SizedBox(height: 4),
              Text(r['description'],
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Color(0xFF67736B), fontSize: 13)),
              const SizedBox(height: 10),
              Row(children: [
                if (p == 'P1' || p == 'P2') ...[
                  PriorityPill(p),
                  const SizedBox(width: 8),
                ],
                Expanded(
                  child: MetaLine([
                    TextSpan(text: j['jobOrderNo'] as String),
                    if (p != 'P1' && p != 'P2' && p != null) TextSpan(text: '$p ${priorityLabel[p]}'),
                    if (overdue)
                      TextSpan(
                        text: 'Overdue since ${formatDay(j['targetDate'])}',
                        style: TextStyle(color: red, fontWeight: FontWeight.w600),
                      )
                    else if (j['targetDate'] != null)
                      TextSpan(text: 'Due ${formatDay(j['targetDate'])}'),
                  ]),
                ),
                if (isNew)
                  Text('Tap to answer',
                      style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                          color: Theme.of(context).colorScheme.primary)),
              ]),
            ],
          ),
        ),
      ),
    );
  }
}
