import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'core/config.dart';
import 'core/nav.dart';
import 'core/theme.dart';
import 'features/auth/auth_provider.dart';
import 'features/auth/login_screen.dart';
import 'features/home/placeholder_home.dart';
import 'features/reports/my_reports_screen.dart';
import 'features/jobs/my_jobs_screen.dart';
import 'features/survey/skills_survey_screen.dart';
import 'features/notifications/notifications.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppConfig.load();
  final theme = ThemeController();
  await theme.load();
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider.value(value: theme),
        ChangeNotifierProvider(create: (_) => NotificationsController()),
      ],
      child: const FacilitrackApp(),
    ),
  );
}

class FacilitrackApp extends StatelessWidget {
  const FacilitrackApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'FACILITRACK',
      navigatorKey: navigatorKey,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: context.watch<ThemeController>().mode,
      home: const Gate(),
    );
  }
}

// shows the right home screen for the signed-in role
class Gate extends StatelessWidget {
  const Gate({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    if (auth.loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final user = auth.user;
    if (user == null) return const LoginScreen();

    switch (user.role) {
      case 'REPORTER':
        return NotificationsScope(key: ValueKey(user.id), child: const MyReportsScreen());
      case 'TECHNICIAN':
        // first sign-in: the skills survey comes before the job list
        return user.needsSurvey
            ? const SkillsSurveyScreen(required: true)
            : NotificationsScope(key: ValueKey(user.id), child: const MyJobsScreen());
      default:
        return const PlaceholderHome(
          title: 'Administration',
          message: 'Coordinators and administrators use the web dashboard.',
        );
    }
  }
}