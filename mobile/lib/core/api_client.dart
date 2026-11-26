import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'config.dart';

class ApiClient {
  ApiClient._() {
    dio = Dio(BaseOptions(
      baseUrl: AppConfig.baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 20),
    ));
    dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        if (token != null) options.headers['Authorization'] = 'Bearer $token';
        handler.next(options);
      },
      onError: (e, handler) {
        // expired or invalid session: send the user back to login
        if (e.response?.statusCode == 401 && token != null) {
          onUnauthorized?.call();
        }
        handler.next(e);
      },
    ));
  }

  static final ApiClient instance = ApiClient._();

  late final Dio dio;
  String? token;
  VoidCallback? onUnauthorized;

  /// Re-point the client after the server address changes.
  void applyBaseUrl() => dio.options.baseUrl = AppConfig.baseUrl;
}

const _networkErrors = {
  DioExceptionType.connectionError,
  DioExceptionType.connectionTimeout,
  DioExceptionType.sendTimeout,
  DioExceptionType.receiveTimeout,
};

String errorMessage(Object e) {
  if (e is DioException) {
    if (_networkErrors.contains(e.type)) {
      return 'Cannot reach the server at ${AppConfig.baseUrl}.\n'
          'Make sure the backend is running, your phone is on the same Wi-Fi as '
          'the PC, and the server address (tap the gear icon) is correct.';
    }
    final data = e.response?.data;
    if (data is Map && data['message'] != null) {
      final m = data['message'];
      return m is List ? m.join('\n') : m.toString();
    }
  }
  return 'Something went wrong. Please try again.';
}