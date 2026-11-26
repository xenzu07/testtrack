import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/realtime.dart';
import '../../core/theme.dart';
import '../auth/account_menu.dart' show ChangePasswordDialog;
import '../auth/auth_provider.dart';
import '../notifications/notifications.dart';
import '../tech/tech_job_screen.dart' show timeAgoShort;
import '../tech/tech_notifications.dart';
import '../tech/v2.dart';
import 'rep_common.dart';
import 'rep_form.dart';
import 'rep_new_report.dart';
import 'rep_report_detail.dart';

/// The reporter app: Home, My Reports and Profile, with the v2 bottom
/// navigation.
class RepShell extends StatefulWidget {
  const RepShell({super.key});

  @override
  State<RepShell> createState() => _RepShellState();
}

class _RepShellState extends State<RepShell> {
  int tab = 0;
  List<Map<String, dynamic>> reports = [];
  bool loading = true;
  String? error;
  StreamSubscription<Map<String, dynamic>>? _sub;

  @override
  void initState() {
    super.initState();
    load();
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
      final res = await ApiClient.instance.dio.get('/reports/mine');
      final list = List<Map<String, dynamic>>.from((res.data as List).map((e) => Map<String, dynamic>.from(e)));
      list.sort((a, b) => _last(b).compareTo(_last(a)));
      reports = list;
      error = null;
    } catch (e) {
      if (!silent) error = errorMessage(e);
    }
    if (mounted) setState(() => loading = false);
  }

  static String _last(Map r) {
    final logs = r['logs'] as List? ?? const [];
    return logs.isEmpty ? r['createdAt'] as String : logs.last['createdAt'] as String;
  }

  Future<void> newReport() async {
    final result = await Navigator.push<Object>(
      context,
      MaterialPageRoute(builder: (_) => const RepNewReportScreen()),
    );
    await load(silent: true);
    if (result is SentResult && mounted) open(result.report['id'] as String);
  }

  void goTab(int i) => setState(() => tab = i);

  Future<void> open(String id, {bool rate = false}) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => RepReportDetailScreen(reportId: id, rate: rate)));
    load(silent: true);
  }

  Future<void> fixForm(Map r) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => RepFormScreen(reportId: r['id'] as String)));
    load(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    final pages = <Widget>[
      _HomeTab(state: this),
      _MyReportsTab(state: this),
      const _ProfileTab(),
    ];
    return V2Scope(
      child: Builder(
        builder: (context) => Scaffold(
          backgroundColor: context.v.bg,
          body: IndexedStack(index: tab, children: pages),
          bottomNavigationBar: V2BottomNav(
            index: tab,
            onTap: (i) => setState(() => tab = i),
            items: const [
              BottomNavItem(V2Icons.building, 'Home'),
              BottomNavItem(V2Icons.list, 'My Reports'),
              BottomNavItem(V2Icons.user, 'Profile'),
            ],
          ),
        ),
      ),
    );
  }
}

/* -------------------------------------------------------------------- bell */

class _Bell extends StatelessWidget {
  const _Bell();

  @override
  Widget build(BuildContext context) {
    final unread = context.watch<NotificationsController>().unread;
    return V2IconButton(
      V2Icons.bell,
      tooltip: unread > 0 ? 'Notifications, $unread unread' : 'Notifications',
      onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const TechNotificationsScreen())),
      badge: unread > 0 ? CountBadge(unread, hot: true, height: 18, fontSize: 10.5) : null,
    );
  }
}

/* -------------------------------------------------------------------- home */

class _HomeTab extends StatelessWidget {
  final _RepShellState state;
  const _HomeTab({required this.state});

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    final user = context.watch<AuthProvider>().user;
    final reports = state.reports;
    final mine = reports.where(needsYou).toList();
    final handled = reports.where((r) => !needsYou(r) && r['status'] != 'CLOSED').toList();

    return Column(children: [
      MTop(padding: const EdgeInsets.fromLTRB(20, 24, 20, 14), children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Meta(longToday(), size: 13),
            const H1('Home', size: 24),
          ]),
        ),
        const _Bell(),
        Semantics(
          button: true,
          label: 'Profile',
          child: GestureDetector(
            onTap: () => state.goTab(2),
            child: Avatar(user?.fullName ?? '', size: 41, color: reporterColor),
          ),
        ),
      ]),
      Expanded(
        child: MBody(top: 0, onRefresh: state.load, children: [
          _cta(context),
          if (state.loading)
            Padding(padding: const EdgeInsets.all(32), child: Center(child: CircularProgressIndicator(color: c.ac)))
          else if (state.error != null) ...[
            Note.text(state.error!, icon: V2Icons.alert),
            V2Button('Try again', block: true, onPressed: state.load),
          ] else if (reports.isEmpty)
            Note.text('No reports yet. Spotted something broken on campus? Tap "Report a problem" and send it with a photo.',
                icon: V2Icons.info)
          else ...[
            if (mine.isNotEmpty) ...[
              _head('Needs you'),
              for (final r in mine) _needsCard(context, r),
            ],
            if (handled.isNotEmpty) ...[
              _head('Being handled'),
              for (final r in handled.take(5)) _handledCard(context, r),
            ],
            if (mine.isEmpty && handled.isEmpty)
              Note.text('Nothing open right now. Your finished reports are in My Reports.', icon: V2Icons.check),
          ],
        ]),
      ),
    ]);
  }

  Widget _head(String title) => Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
          Expanded(child: H2(title)),
          TextLink('See all', onTap: () => state.goTab(1)),
        ]),
      );

  Widget _cta(BuildContext context) {
    final c = context.v;
    return Semantics(
      button: true,
      child: Material(
        color: c.acf,
        borderRadius: BorderRadius.circular(18),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: state.newReport,
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Row(children: [
              Container(
                width: 44,
                height: 44,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(14)),
                child: const V2Icon(V2Icons.plus, size: 20, color: Colors.white),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Report a problem',
                      style: v2Text(size: 17, weight: FontWeight.w800, color: Colors.white, height: 1.3)),
                  Text('Takes about a minute · photo required',
                      style: v2Text(size: 13, color: Colors.white.withValues(alpha: 0.85))),
                ]),
              ),
            ]),
          ),
        ),
      ),
    );
  }

  Widget _card(BuildContext context, Map<String, dynamic> r,
      {required Widget status, String? when, required String button, required VoidCallback onTap, bool highlight = false, String? extra}) {
    final c = context.v;
    final meta = [placeShort(r['location'] as Map?), ?extra].join(' · ');
    return MCard(
      borderColor: highlight ? c.acl : null,
      onTap: onTap,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          IconSquare.category(r['category']?['name'] as String?),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${r['category']?['name']}', style: v2Text(size: 15, weight: FontWeight.w700, color: c.tx, height: 1.35)),
              Text(meta, maxLines: 1, overflow: TextOverflow.ellipsis, style: v2Text(size: 12.5, color: c.tx3)),
            ]),
          ),
          const SizedBox(width: 8),
          PriorityLabel(priorityOf(r)),
        ]),
        const SizedBox(height: 10),
        Row(children: [
          Flexible(child: status),
          const Spacer(),
          if (when != null) rowEnd(context, Meta(when, align: TextAlign.right)),
        ]),
        const SizedBox(height: 14),
        V2Button(button, kind: BtnKind.pri, block: true, onPressed: onTap),
      ]),
    );
  }

  Widget _needsCard(BuildContext context, Map<String, dynamic> r) {
    if (needsRating(r)) {
      return _card(context, r,
          highlight: true,
          status: const V2Tag('Fixed · rate the repair', tone: TagTone.good),
          when: timeAgoShort(reachedAt(r, 'CLOSED') ?? r['createdAt'] as String),
          button: 'Rate Repair',
          onTap: () => state.open(r['id'] as String, rate: true));
    }
    if (formReturned(r)) {
      return _card(context, r,
          highlight: true,
          status: const V2Tag('Form returned · needs a change', tone: TagTone.warn),
          when: r['jobOrderForm']?['submittedAt'] == null ? null : timeAgoShort(r['jobOrderForm']['submittedAt'] as String),
          button: 'Fix Form',
          onTap: () => state.fixForm(r));
    }
    return _card(context, r,
        highlight: true,
        status: const V2Tag('Form not signed yet', tone: TagTone.warn),
        when: timeAgoShort(r['createdAt'] as String),
        button: 'Sign Form',
        onTap: () => state.fixForm(r));
  }

  Widget _handledCard(BuildContext context, Map<String, dynamic> r) => _card(context, r,
      status: reportStatus(r, withTarget: true),
      extra: techName(r),
      button: 'Open Report',
      onTap: () => state.open(r['id'] as String));
}

/* -------------------------------------------------------------- my reports */

enum _Filter { all, open, done }

class _MyReportsTab extends StatefulWidget {
  final _RepShellState state;
  const _MyReportsTab({required this.state});

  @override
  State<_MyReportsTab> createState() => _MyReportsTabState();
}

class _MyReportsTabState extends State<_MyReportsTab> {
  _Filter filter = _Filter.all;

  @override
  Widget build(BuildContext context) {
    final s = widget.state;
    final c = context.v;
    final reports = s.reports;
    final mine = reports.where(needsYou).toList();
    final handled = reports.where((r) => !needsYou(r) && r['status'] != 'CLOSED').toList();
    final done = reports.where((r) => !needsYou(r) && r['status'] == 'CLOSED').toList();
    final open = mine.length + handled.length;

    return Column(children: [
      const MTop(padding: EdgeInsets.fromLTRB(20, 24, 20, 14), children: [Expanded(child: H1('My Reports', size: 24)), _Bell()]),
      Expanded(
        child: MBody(onRefresh: s.load, children: [
          Seg<_Filter>(
            selected: filter,
            onChanged: (f) => setState(() => filter = f),
            options: [
              (_Filter.all, 'All ${reports.length}'),
              (_Filter.open, 'Open $open'),
              (_Filter.done, 'Done ${done.length}'),
            ],
          ),
          if (s.loading)
            Padding(padding: const EdgeInsets.all(32), child: Center(child: CircularProgressIndicator(color: c.ac)))
          else if (s.error != null) ...[
            Note.text(s.error!, icon: V2Icons.alert),
            V2Button('Try again', block: true, onPressed: s.load),
          ] else if (reports.isEmpty)
            Note.text('No reports yet. Use "Report a problem" on Home to send one.', icon: V2Icons.info)
          else ...[
            if (filter != _Filter.done && mine.isNotEmpty) ...[
              const Padding(padding: EdgeInsets.only(top: 4), child: H2('Needs you')),
              CardRows([for (final r in mine) _row(r)]),
            ],
            if (filter != _Filter.done && handled.isNotEmpty) ...[
              const Padding(padding: EdgeInsets.only(top: 4), child: H2('Being handled')),
              CardRows([for (final r in handled) _row(r)]),
            ],
            if (filter != _Filter.open && done.isNotEmpty) ...[
              const Padding(padding: EdgeInsets.only(top: 4), child: H2('Done')),
              CardRows([for (final r in done) _row(r)]),
            ],
            if (filter == _Filter.open && open == 0) Note.text('Nothing open right now.', icon: V2Icons.check),
            if (filter == _Filter.done && done.isEmpty) Note.text('Closed reports appear here.', icon: V2Icons.info),
          ],
        ]),
      ),
    ]);
  }

  Widget _row(Map<String, dynamic> r) {
    final c = context.v;
    final s = widget.state;
    final String when;
    final Widget right;
    VoidCallback onTap = () => s.open(r['id'] as String);
    if (needsRating(r)) {
      when = 'Fixed ${shortLocalDay(reachedAt(r, 'CLOSED') ?? reachedAt(r, 'COMPLETED'))}';
      right = const V2Tag('Rate', tone: TagTone.good);
      onTap = () => s.open(r['id'] as String, rate: true);
    } else if (formReturned(r)) {
      when = 'Form returned ${shortLocalDay(r['jobOrderForm']?['submittedAt'])}';
      right = const V2Tag('Fix Form', tone: TagTone.warn);
      onTap = () => s.fixForm(r);
    } else if (formMissing(r)) {
      when = 'Reported ${shortLocalDay(r['createdAt'])}';
      right = const V2Tag('Sign Form', tone: TagTone.warn);
      onTap = () => s.fixForm(r);
    } else {
      final job = activeJob(r);
      final tech = techName(r);
      when = switch (r['status']) {
        'CLOSED' => [
            'Closed ${shortLocalDay(reachedAt(r, 'CLOSED'))}',
            if (r['feedback'] != null) 'you rated ${r['feedback']['rating']}',
          ].join(' · '),
        'COMPLETED' => 'Finished ${shortLocalDay(reachedAt(r, 'COMPLETED'))}',
        'IN_PROGRESS' || 'DELAYED' || 'ASSIGNED' when tech != null => [
            tech,
            if (job?['targetDate'] != null) 'target ${shortDay(job!['targetDate'])}',
          ].join(' · '),
        _ => 'Reported ${shortLocalDay(r['createdAt'])}',
      };
      right = reportStatus(r);
    }
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(children: [
          IconSquare.category(r['category']?['name'] as String?),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${r['category']?['name']}', style: v2Text(size: 14.5, weight: FontWeight.w700, color: c.tx, height: 1.35)),
              Text(placeShort(r['location'] as Map?),
                  maxLines: 1, overflow: TextOverflow.ellipsis, style: v2Text(size: 12.5, color: c.tx3)),
              Text(when, maxLines: 1, overflow: TextOverflow.ellipsis, style: v2Text(size: 12.5, color: c.tx3)),
            ]),
          ),
          const SizedBox(width: 8),
          rowEnd(context, right),
        ]),
      ),
    );
  }
}

/* ----------------------------------------------------------------- profile */

class _ProfileTab extends StatelessWidget {
  const _ProfileTab();

  Future<void> _signOutEverywhere(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Sign out of all devices?', style: v2Text(size: 18, weight: FontWeight.w700, color: ctx.v.tx)),
        content: Text('You will be signed out here and on every other phone or browser.', style: v2Text(color: ctx.v.tx2)),
        actions: [
          V2Button('Cancel', kind: BtnKind.ghost, onPressed: () => Navigator.pop(ctx, false)),
          V2Button('Sign out', kind: BtnKind.pri, onPressed: () => Navigator.pop(ctx, true)),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    try {
      await context.read<AuthProvider>().logoutEverywhere();
    } catch (e) {
      if (context.mounted) v2Snack(context, errorMessage(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    final u = context.watch<AuthProvider>().user;
    final unread = context.watch<NotificationsController>().unread;
    final theme = context.watch<ThemeController>();
    final type = u?.userType;

    Widget row(String icon, String label, {Widget? trailing, Color? color, VoidCallback? onTap}) => InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            child: Row(children: [
              V2Icon(icon, size: 20, color: color ?? c.tx3),
              const SizedBox(width: 12),
              Expanded(child: Text(label, style: v2Text(size: 14.5, weight: FontWeight.w600, color: color ?? c.tx))),
              if (trailing != null) ...[const SizedBox(width: 8), rowEnd(context, trailing)],
            ]),
          ),
        );

    return Column(children: [
      const MTop(padding: EdgeInsets.fromLTRB(20, 24, 20, 14), children: [Expanded(child: H1('Profile', size: 24))]),
      Expanded(
        child: MBody(children: [
          MCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Avatar(u?.fullName ?? '', size: 44, color: reporterColor),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(u?.fullName ?? '', style: v2Text(size: 17, weight: FontWeight.w700, color: c.tx, height: 1.35)),
                    Meta(['Reporter', if (u?.email != null) u!.email!].join(' · ')),
                  ]),
                ),
              ]),
              if (type != null && type.isNotEmpty) ...[
                const SizedBox(height: 14),
                V2Tag(type[0].toUpperCase() + type.substring(1).toLowerCase(), tone: TagTone.good),
              ],
            ]),
          ),
          CardRows([
            row(V2Icons.bell, 'Notifications',
                trailing: unread > 0 ? CountBadge(unread, hot: true) : null,
                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const TechNotificationsScreen()))),
            row(V2Icons.moon, 'Dark mode', trailing: _Toggle(on: theme.isDark), onTap: theme.toggle),
          ]),
          CardRows([
            row(V2Icons.lock, 'Change password',
                onTap: () => showDialog(context: context, builder: (_) => const ChangePasswordDialog())),
            row(V2Icons.devices, 'Sign out of all devices', onTap: () => _signOutEverywhere(context)),
            row(V2Icons.logout, 'Sign out', color: c.red, onTap: () => context.read<AuthProvider>().logout()),
          ]),
          const Meta('FACILITRACK · CvSU Imus General Services Office', align: TextAlign.center),
        ]),
      ),
    ]);
  }
}

class _Toggle extends StatelessWidget {
  final bool on;
  const _Toggle({required this.on});

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    return Semantics(
      toggled: on,
      label: 'Dark mode ${on ? 'on' : 'off'}',
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        width: 44,
        height: 26,
        padding: const EdgeInsets.all(3),
        alignment: on ? Alignment.centerRight : Alignment.centerLeft,
        decoration: BoxDecoration(color: on ? c.acf : c.line2, borderRadius: BorderRadius.circular(13)),
        child: Container(width: 20, height: 20, decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle)),
      ),
    );
  }
}
