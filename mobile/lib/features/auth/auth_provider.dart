import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/api_client.dart';
import '../../core/nav.dart';
import '../../core/realtime.dart';

class AuthUser {
  final String id;
  final String fullName;
  final String role;
  // filled in from /auth/me; null until loaded or when not a technician
  final String? tradeUnitName;
  // technicians only: when the skills survey was done (null = not yet).
  // [surveyKnown] is false for sessions saved before this field existed,
  // until the profile has been refreshed.
  final String? surveyCompletedAt;
  final bool surveyKnown;
  // technical roles from the survey, e.g. ['Plumbing', 'Electrical']
  final List<String> roles;
  AuthUser({
    required this.id,
    required this.fullName,
    required this.role,
    this.tradeUnitName,
    this.surveyCompletedAt,
    this.surveyKnown = false,
    this.roles = const [],
  });

  bool get needsSurvey =>
      role == 'TECHNICIAN' && surveyKnown && surveyCompletedAt == null;

  factory AuthUser.fromJson(Map<String, dynamic> j) => AuthUser(
        id: j['id'],
        fullName: j['fullName'],
        role: j['role'],
        tradeUnitName: j['tradeUnitName'] as String?,
        surveyCompletedAt: j['surveyCompletedAt'] as String?,
        surveyKnown: j.containsKey('surveyCompletedAt'),
        roles: List<String>.from(j['roles'] as List? ?? const []),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'fullName': fullName,
        'role': role,
        if (tradeUnitName != null) 'tradeUnitName': tradeUnitName,
        if (surveyKnown) 'surveyCompletedAt': surveyCompletedAt,
        'roles': roles,
      };
}

class AuthProvider extends ChangeNotifier {
  AuthUser? user;
  bool loading = true;

  AuthProvider() {
    ApiClient.instance.onUnauthorized = logout;
    _restore();
  }

  Future<void> _restore() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('token');
    final saved = prefs.getString('user');
    if (token != null && saved != null) {
      ApiClient.instance.token = token;
      Realtime.instance.connect();
      user = AuthUser.fromJson(jsonDecode(saved));
      refreshProfile();
    }
    loading = false;
    notifyListeners();
  }

  Future<void> _saveUser() async {
    final prefs = await SharedPreferences.getInstance();
    if (user != null) await prefs.setString('user', jsonEncode(user!.toJson()));
  }

  Future<void> login(String email, String password) async {
    final res = await ApiClient.instance.dio
        .post('/auth/login', data: {'email': email.trim().toLowerCase(), 'password': password});
    final token = res.data['accessToken'] as String;
    final u = AuthUser.fromJson(res.data['user']);

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('token', token);
    ApiClient.instance.token = token;
    user = u;
    await _saveUser();

    Realtime.instance.connect();
    notifyListeners();
    refreshProfile();
  }

  // name changes and the trade unit come from the server; failures are
  // ignored (the saved copy is still shown)
  Future<void> refreshProfile() async {
    try {
      final res = await ApiClient.instance.dio.get('/auth/me');
      final p = Map<String, dynamic>.from(res.data);
      final current = user;
      if (current == null) return;
      user = AuthUser(
        id: current.id,
        fullName: p['fullName'] as String? ?? current.fullName,
        role: p['role'] as String? ?? current.role,
        tradeUnitName: (p['tradeUnit'] as Map?)?['name'] as String?,
        surveyCompletedAt: p['surveyCompletedAt'] as String?,
        surveyKnown: true,
        roles: [
          for (final r in (p['technicianRoles'] as List? ?? const []))
            (r['tradeUnit']?['name'] ?? '') as String,
        ].where((n) => n.isNotEmpty).toList(),
      );
      await _saveUser();
      notifyListeners();
    } catch (_) {
      // offline or signed out meanwhile
    }
  }

  // after a password change the server issues a new token for this device
  Future<void> replaceToken(String token) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('token', token);
    ApiClient.instance.token = token;
    Realtime.instance.connect();
  }

  Future<void> logoutEverywhere() async {
    await ApiClient.instance.dio.post('/auth/logout-all');
    await logout();
  }

  Future<void> logout() async {
    Realtime.instance.disconnect();
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('token');
    await prefs.remove('user');
    ApiClient.instance.token = null;
    user = null;
    navigatorKey.currentState?.popUntil((r) => r.isFirst);
    notifyListeners();
  }
}
