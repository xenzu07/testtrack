import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

class AppConfig {
  // Default server address. Override at build time with:
  //   flutter run --dart-define=API_URL=http://192.168.1.15:3000
  // or change it at any time from the login screen (Server settings).
  //
  // Android emulator: 10.0.2.2 reaches your PC.
  // Real phone: your PC's IPv4 on the same Wi-Fi, e.g. 'http://192.168.1.15:3000'
  static const String _defaultMobileUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'http://192.168.1.12:3000',
  );

  static const String _prefsKey = 'server_url';
  static String? _override;

  /// Load the server address saved from the login screen (call before runApp).
  static Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    _override = prefs.getString(_prefsKey);
  }

  static String get baseUrl {
    if (kIsWeb) return 'http://localhost:3000';
    return _override ?? _defaultMobileUrl;
  }

  /// Accepts '192.168.1.15', '192.168.1.15:3000' or a full URL.
  static String normalize(String input) {
    var url = input.trim();
    if (url.isEmpty) return url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'http://$url';
    }
    while (url.endsWith('/')) {
      url = url.substring(0, url.length - 1);
    }
    final uri = Uri.tryParse(url);
    if (uri != null && !uri.hasPort && uri.scheme == 'http') {
      url = '$url:3000';
    }
    return url;
  }

  static Future<void> setBaseUrl(String input) async {
    final prefs = await SharedPreferences.getInstance();
    final url = normalize(input);
    if (url.isEmpty) {
      _override = null;
      await prefs.remove(_prefsKey);
    } else {
      _override = url;
      await prefs.setString(_prefsKey, url);
    }
  }
}
