import 'dart:async';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'api_client.dart';

/// Phone push through Firebase Cloud Messaging.
///
/// The Firebase project is given at build time, so the app needs no
/// google-services.json and builds without one:
///   flutter run --dart-define=FIREBASE_API_KEY=... \
///     --dart-define=FIREBASE_APP_ID=... \
///     --dart-define=FIREBASE_MESSAGING_SENDER_ID=... \
///     --dart-define=FIREBASE_PROJECT_ID=...
/// Without them push stays off; the in-app notification list still works.
class PushService {
  PushService._();
  static final PushService instance = PushService._();

  static const _apiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const _appId = String.fromEnvironment('FIREBASE_APP_ID');
  static const _senderId = String.fromEnvironment('FIREBASE_MESSAGING_SENDER_ID');
  static const _projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');

  static bool get configured =>
      _apiKey.isNotEmpty && _appId.isNotEmpty && _senderId.isNotEmpty && _projectId.isNotEmpty;

  // Firebase Cloud Messaging exists only on Android and iOS; on Windows,
  // macOS, Linux and the web the in-app notification list is used alone
  static bool get supported =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android || defaultTargetPlatform == TargetPlatform.iOS);

  bool _ready = false;
  // set after a failed setup so it is not retried on every sign-in / resume
  bool _failed = false;
  String? _token;
  StreamSubscription<String>? _refreshSub;

  /// The user tapped a push: the app opens the related screen.
  final _opened = StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get opened => _opened.stream;

  /// 'off' (not set up in this build), 'denied', 'on' or 'unknown'
  String state = 'unknown';

  Future<bool> _init() async {
    if (_ready) return true;
    if (_failed) return false;
    if (!supported || !configured) {
      state = 'off';
      return false;
    }
    try {
      await Firebase.initializeApp(
        options: const FirebaseOptions(
          apiKey: _apiKey,
          appId: _appId,
          messagingSenderId: _senderId,
          projectId: _projectId,
        ),
      );
      FirebaseMessaging.onMessageOpenedApp.listen((m) => _opened.add(m.data));
      final initial = await FirebaseMessaging.instance.getInitialMessage();
      if (initial != null) {
        // let the home screen build first
        Timer(const Duration(milliseconds: 600), () => _opened.add(initial.data));
      }
      _ready = true;
      return true;
    } on MissingPluginException {
      // the native plugin is not in this build (e.g. after only a hot
      // restart): a full rebuild with `flutter run` fixes it
      debugPrint('Push is off: the Firebase plugin is missing from this build. '
          'Stop the app and run `flutter run` again (not hot restart).');
      _failed = true;
      state = 'off';
      return false;
    } catch (e) {
      debugPrint('Push setup failed: $e');
      _failed = true;
      state = 'off';
      return false;
    }
  }

  /// Asks for permission (Android 13+ / iOS) and registers this phone for the
  /// signed-in user. Safe to call on every start: failures only turn push off.
  Future<void> register() async {
    if (!await _init()) return;
    try {
      final fm = FirebaseMessaging.instance;
      final perm = await fm.requestPermission();
      if (perm.authorizationStatus == AuthorizationStatus.denied) {
        state = 'denied';
        return;
      }
      // Registration tokens are what the backend's FCM HTTP v1 sender
      // targets. firebase_messaging 17 deprecates them in favour of
      // installation IDs, which the HTTP v1 "token" field is not documented
      // to accept yet, so the token API is kept on purpose.
      // ignore: deprecated_member_use
      final token = await fm.getToken();
      if (token == null) return;
      await _send(token);
      // ignore: deprecated_member_use
      _refreshSub ??= fm.onTokenRefresh.listen((t) => _send(t));
      state = 'on';
    } catch (e) {
      debugPrint('Push registration failed: $e');
    }
  }

  Future<void> _send(String token) async {
    _token = token;
    if (ApiClient.instance.token == null) return;
    await ApiClient.instance.dio.post('/notifications/devices', data: {
      'platform': defaultTargetPlatform == TargetPlatform.iOS ? 'IOS' : 'ANDROID',
      'token': token,
    });
  }

  /// Before signing out: this phone stops receiving the account's pushes.
  Future<void> unregister() async {
    final token = _token;
    _token = null;
    if (!_ready) return;
    try {
      if (token != null && ApiClient.instance.token != null) {
        await ApiClient.instance.dio
            .delete('/notifications/devices', data: {'token': token})
            .timeout(const Duration(seconds: 4));
      }
      // a new token is issued for the next account that signs in here
      // ignore: deprecated_member_use
      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {
      // the server also forgets devices when every session of a user ends
    }
  }
}
