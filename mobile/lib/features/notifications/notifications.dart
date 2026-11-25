import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/nav.dart';
import '../../core/push.dart';
import '../../core/realtime.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import '../auth/auth_provider.dart';
import '../forms/form_detail_screen.dart';
import '../jobs/job_detail_screen.dart';
import '../reports/report_detail_screen.dart';

/// The signed-in user's notifications: list, unread count, read state.
/// New ones arrive over the live connection; the list is reloaded when the
/// app comes back to the foreground.
class NotificationsController extends ChangeNotifier with WidgetsBindingObserver {
  List<Map<String, dynamic>> items = [];
  int unread = 0;
  bool hasMore = false;
  bool loading = false;
  String? error;
  String? _userId;
  StreamSubscription<Map<String, dynamic>>? _sub;

  NotificationsController() {
    WidgetsBinding.instance.addObserver(this);
    _sub = Realtime.instance.notifications.listen((n) {
      if (_userId == null || n['userId'] != _userId) return;
      if (items.any((x) => x['id'] == n['id'])) return;
      items = [n, ...items];
      unread += 1;
      notifyListeners();
    });
  }

  /// Called by the home screens; loads once per signed-in account.
  void start(String userId) {
    if (_userId == userId) return;
    _userId = userId;
    items = [];
    unread = 0;
    load();
  }

  void clear() {
    _userId = null;
    items = [];
    unread = 0;
    notifyListeners();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _userId != null) load(silent: true);
  }

  Future<void> load({bool silent = false}) async {
    if (!silent) {
      loading = true;
      error = null;
      notifyListeners();
    }
    try {
      final res = await ApiClient.instance.dio.get('/notifications', queryParameters: {'limit': 30});
      items = List<Map<String, dynamic>>.from(
          (res.data['items'] as List).map((e) => Map<String, dynamic>.from(e)));
      unread = res.data['unread'] as int;
      hasMore = res.data['hasMore'] as bool;
      error = null;
    } catch (e) {
      if (!silent) error = errorMessage(e);
    }
    loading = false;
    notifyListeners();
  }

  Future<void> loadMore() async {
    if (items.isEmpty) return;
    final res = await ApiClient.instance.dio.get('/notifications',
        queryParameters: {'limit': 30, 'before': items.last['createdAt']});
    final more = (res.data['items'] as List).map((e) => Map<String, dynamic>.from(e));
    items = [...items, ...more.where((n) => !items.any((x) => x['id'] == n['id']))];
    hasMore = res.data['hasMore'] as bool;
    notifyListeners();
  }

  Future<void> markRead(Map<String, dynamic> n) async {
    if (n['readAt'] != null) return;
    n['readAt'] = DateTime.now().toIso8601String();
    unread = unread > 0 ? unread - 1 : 0;
    notifyListeners();
    try {
      final res = await ApiClient.instance.dio.post('/notifications/${n['id']}/read');
      unread = res.data['unread'] as int;
      notifyListeners();
    } catch (_) {}
  }

  Future<void> markAllRead() async {
    await ApiClient.instance.dio.post('/notifications/read-all');
    final now = DateTime.now().toIso8601String();
    for (final n in items) {
      n['readAt'] ??= now;
    }
    unread = 0;
    notifyListeners();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _sub?.cancel();
    super.dispose();
  }
}

/// Opens the screen a notification is about (from the list or a push tap).
Future<void> openNotificationTarget(Map<String, dynamic> data) async {
  final nav = navigatorKey.currentState;
  final context = navigatorKey.currentContext;
  if (nav == null || context == null) return;
  final role = context.read<AuthProvider>().user?.role;
  final formId = data['formId'] as String?;
  final jobId = data['jobOrderId'] as String?;
  final reportId = data['reportId'] as String?;
  Widget? screen;
  if (role == 'TECHNICIAN' && jobId != null && jobId.isNotEmpty) {
    screen = JobDetailScreen(jobId: jobId);
  } else if (role == 'REPORTER' && formId != null && formId.isNotEmpty) {
    screen = FormDetailScreen(formId: formId);
  } else if (role == 'REPORTER' && reportId != null && reportId.isNotEmpty) {
    screen = ReportDetailScreen(reportId: reportId);
  }
  if (screen != null) await nav.push(MaterialPageRoute(builder: (_) => screen!));
}

/// Bell for the top bar, with the unread count.
class NotificationBell extends StatelessWidget {
  const NotificationBell({super.key});

  @override
  Widget build(BuildContext context) {
    final unread = context.watch<NotificationsController>().unread;
    return IconButton(
      tooltip: unread > 0 ? 'Notifications, $unread unread' : 'Notifications',
      onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const NotificationsScreen())),
      icon: Badge(
        isLabelVisible: unread > 0,
        // a small count beside the bell, not over it; same red in both themes
        offset: const Offset(9, -5),
        backgroundColor: const Color(0xFFC63B27),
        textColor: Colors.white,
        textStyle: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700),
        label: Text(unread > 99 ? '99+' : '$unread'),
        child: const Icon(Icons.notifications_none),
      ),
    );
  }
}

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  bool onlyUnread = false;

  @override
  Widget build(BuildContext context) {
    final n = context.watch<NotificationsController>();
    final c = context.c;
    final shown = onlyUnread ? n.items.where((x) => x['readAt'] == null).toList() : n.items;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          if (n.unread > 0)
            TextButton(onPressed: n.markAllRead, child: const Text('Mark all read')),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: n.load,
        child: ReadableWidth(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
            children: [
              FilterBar<bool>(
                selected: onlyUnread,
                onSelected: (v) => setState(() => onlyUnread = v),
                options: [
                  FilterOption(false, 'All', n.items.length),
                  FilterOption(true, 'Unread', n.unread, alert: true),
                ],
              ),
              const SizedBox(height: 8),
              if (PushService.instance.state == 'denied')
                const Padding(
                  padding: EdgeInsets.only(bottom: 10),
                  child: Callout(
                    'Notifications are blocked for FACILITRACK. Allow them in your phone settings to get alerts when the app is closed.',
                    kind: CalloutKind.warn,
                  ),
                ),
              if (n.error != null)
                Padding(padding: const EdgeInsets.only(bottom: 10), child: Callout(n.error!, kind: CalloutKind.danger)),
              if (n.loading && n.items.isEmpty)
                const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))
              else if (shown.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 48),
                  child: Text(onlyUnread ? 'No unread notifications.' : 'You have no notifications yet.',
                      textAlign: TextAlign.center, style: TextStyle(color: c.muted, fontSize: 15)),
                )
              else
                Card(
                  margin: EdgeInsets.zero,
                  child: Column(children: [
                    for (var i = 0; i < shown.length; i++) ...[
                      if (i > 0) Divider(height: 1, color: c.border),
                      _Tile(shown[i]),
                    ],
                  ]),
                ),
              if (n.hasMore && !onlyUnread)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: OutlinedButton(onPressed: n.loadMore, child: const Text('Load older')),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Tile extends StatelessWidget {
  final Map<String, dynamic> n;
  const _Tile(this.n);

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final unread = n['readAt'] == null;
    return InkWell(
      onTap: () {
        context.read<NotificationsController>().markRead(n);
        openNotificationTarget(n);
      },
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            width: 8,
            height: 8,
            margin: const EdgeInsets.only(top: 7, right: 12),
            decoration: BoxDecoration(color: unread ? c.green : Colors.transparent, shape: BoxShape.circle),
          ),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(
                  child: Text(n['title'] as String,
                      style: TextStyle(
                          fontSize: 15,
                          fontWeight: unread ? FontWeight.w700 : FontWeight.w500,
                          color: unread ? c.text : c.text2)),
                ),
                const SizedBox(width: 8),
                Text(timeAgo(n['createdAt'] as String), style: TextStyle(fontSize: 12.5, color: c.muted)),
              ]),
              const SizedBox(height: 3),
              Text(n['body'] as String, style: TextStyle(fontSize: 14, color: c.muted, height: 1.35)),
            ]),
          ),
        ]),
      ),
    );
  }
}

/// Starts the notifications for the signed-in account and opens the screen
/// for pushes the user taps. Wrap each home screen with it.
class NotificationsScope extends StatefulWidget {
  final Widget child;
  const NotificationsScope({super.key, required this.child});

  @override
  State<NotificationsScope> createState() => _NotificationsScopeState();
}

class _NotificationsScopeState extends State<NotificationsScope> {
  StreamSubscription<Map<String, dynamic>>? _opened;
  StreamSubscription<Map<String, dynamic>>? _live;

  @override
  void initState() {
    super.initState();
    final me = context.read<AuthProvider>().user?.id;
    final ctrl = context.read<NotificationsController>();
    _live = Realtime.instance.notifications.listen((n) {
      // offers already open the accept / decline sheet on the job list
      if (!mounted || n['userId'] != me || n['kind'] == 'job.offered') return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('${n['title']}: ${n['body']}', maxLines: 2, overflow: TextOverflow.ellipsis),
        action: SnackBarAction(
          label: 'View',
          onPressed: () {
            ctrl.markRead(n);
            openNotificationTarget(n);
          },
        ),
      ));
    });
    // after the first frame: loading notifies listeners, which is not
    // allowed while the widget tree is still being built
    if (me != null) WidgetsBinding.instance.addPostFrameCallback((_) => ctrl.start(me));
    _opened = PushService.instance.opened.listen((data) {
      ctrl.load(silent: true);
      openNotificationTarget(data);
    });
  }

  @override
  void dispose() {
    _opened?.cancel();
    _live?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
