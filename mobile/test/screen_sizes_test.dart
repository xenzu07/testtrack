// Every technician and reporter screen, rendered with awkward sample data at
// common phone sizes (small to large, portrait and landscape, and a tablet)
// and with the phone's text size turned up. Any overflow ("BOTTOM OVERFLOWED
// BY 4 PIXELS" stripes) or other layout error fails the test, naming the
// screen, the size and the text scale.
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:facilitrack_mobile/core/theme.dart';
import 'package:facilitrack_mobile/features/auth/auth_provider.dart';
import 'package:facilitrack_mobile/features/auth/login_screen.dart';
import 'package:facilitrack_mobile/features/notifications/notifications.dart';
import 'package:facilitrack_mobile/features/reporter/rep_form.dart';
import 'package:facilitrack_mobile/features/reporter/rep_home.dart';
import 'package:facilitrack_mobile/features/reporter/rep_new_report.dart';
import 'package:facilitrack_mobile/features/reporter/rep_report_detail.dart';
import 'package:facilitrack_mobile/features/survey/skills_survey_screen.dart';
import 'package:facilitrack_mobile/features/tech/tech_home.dart';
import 'package:facilitrack_mobile/features/tech/tech_job_screen.dart';
import 'package:facilitrack_mobile/features/tech/tech_notifications.dart';
import 'support/fake_api.dart';

/// Phone and tablet sizes in logical pixels.
const devices = <String, Size>{
  'small phone 320x568': Size(320, 568),
  'Android 360x640': Size(360, 640),
  'iPhone 390x844': Size(390, 844),
  'large phone 430x932': Size(430, 932),
  'landscape 640x360': Size(640, 360),
  'tablet 768x1024': Size(768, 1024),
};

/// Normal text, and the phone's "large text" settings.
const textScales = [1.0, 1.3, 1.6];

// a 1 x 1 PNG for the camera
final _png = Uint8List.fromList([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
  0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
  0x00, 0x03, 0x01, 0x01, 0x00, 0xC9, 0xFE, 0x92, 0xEF, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
  0x44, 0xAE, 0x42, 0x60, 0x82,
]);

class _FakePicker extends ImagePickerPlatform with MockPlatformInterfaceMixin {
  @override
  Future<XFile?> getImageFromSource({required ImageSource source, ImagePickerOptions options = const ImagePickerOptions()}) async =>
      XFile.fromData(_png, name: 'photo.png', mimeType: 'image/png');
}

AuthUser _user(String role) => AuthUser(
      id: 'me',
      fullName: role == 'TECHNICIAN' ? 'Ramon Cruz Villanueva' : 'Maria Clara Santos-Dela Cruz',
      role: role,
      email: role == 'TECHNICIAN' ? 'ramon.cruz.villanueva@cvsu.edu.ph' : 'maria.clara.santos@cvsu.edu.ph',
      userType: 'student',
      surveyKnown: true,
      surveyCompletedAt: '2026-11-03T00:00:00Z',
    );

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 60));
  }
}

/// Scrolls every vertical list on screen to the end, so content below the
/// fold is built and laid out too.
Future<void> _scrollAll(WidgetTester tester) async {
  for (final s in tester.stateList<ScrollableState>(find.byType(Scrollable))) {
    final p = s.position;
    if (p.axis == Axis.vertical && p.maxScrollExtent > 0) p.jumpTo(p.maxScrollExtent);
  }
  await _settle(tester);
}

Future<void> _tap(WidgetTester tester, Finder f) async {
  await tester.ensureVisible(f.first);
  await tester.pump();
  await tester.tap(f.first, warnIfMissed: false);
  await _settle(tester);
}

/// Renders [home] at every size and text scale, runs [act] (taps, sheets),
/// and returns a description of every layout error.
Future<void> checkScreen(
  WidgetTester tester,
  String name,
  Widget Function() home, {
  String role = 'TECHNICIAN',
  Future<void> Function(WidgetTester t)? act,
}) async {
  final problems = <String>[];
  for (final d in devices.entries) {
    for (final scale in textScales) {
      tester.view.physicalSize = d.value;
      tester.view.devicePixelRatio = 1;
      final where = '$name on ${d.key}, text x$scale';
      final old = FlutterError.onError;
      FlutterError.onError = (e) {
        final first = e.exceptionAsString().split('\n').first;
        problems.add('$where: $first');
      };
      try {
        final auth = AuthProvider();
        await tester.pump();
        auth.user = _user(role);
        final notes = NotificationsController()..start('me');
        await tester.pumpWidget(MultiProvider(
          key: UniqueKey(),
          providers: [
            ChangeNotifierProvider.value(value: auth),
            ChangeNotifierProvider(create: (_) => ThemeController()),
            ChangeNotifierProvider.value(value: notes),
          ],
          child: MaterialApp(
            theme: AppTheme.dark(),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
              child: child!,
            ),
            home: home(),
          ),
        ));
        await _settle(tester);
        await _scrollAll(tester);
        if (act != null) await act(tester);
      } catch (e) {
        problems.add('$where: ${'$e'.split('\n').first}');
      } finally {
        FlutterError.onError = old;
      }
    }
  }
  tester.view.reset();
  expect(problems.toSet().toList(), isEmpty);
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    useFakeServer();
    fakeServer.respond = null;
    ImagePickerPlatform.instance = _FakePicker();
  });

  group('technician', () {
    testWidgets('Home and every tab', (t) async {
      await checkScreen(t, 'Tech home', () => const TechShell(), act: (t) async {
        for (final tab in ['History', 'My Stats', 'Profile']) {
          await _tap(t, find.text(tab).last);
          await _scrollAll(t);
        }
      });
    });

    for (final s in [
      ('new offer', 'ASSIGNED', 'PENDING'),
      ('ready to start', 'ASSIGNED', 'ACCEPTED'),
      ('in progress', 'IN_PROGRESS', 'ACCEPTED'),
      ('paused', 'DELAYED', 'ACCEPTED'),
      ('waiting for the check', 'COMPLETED', 'ACCEPTED'),
    ]) {
      testWidgets('Job detail, ${s.$1}', (t) async {
        fakeServer.respond = (o) => o.path.startsWith('/job-orders/j') ? job(s.$2, answer: s.$3) : null;
        await checkScreen(t, 'Job ${s.$1}', () => const TechJobScreen(jobId: 'j1'));
      });
    }

    testWidgets('Job sheets: decline, update, finish, delay', (t) async {
      fakeServer.respond = (o) => o.path.startsWith('/job-orders/j') ? job('IN_PROGRESS') : null;
      await checkScreen(t, 'Job sheets', () => const TechJobScreen(jobId: 'j1'), act: (t) async {
        await _tap(t, find.text('Update'));
        await _tap(t, find.text('Gallery'));
        await _scrollAll(t);
        await _tap(t, find.text('Cancel'));
        await _tap(t, find.text('Finish job'));
        await _tap(t, find.text('Camera'));
        await _scrollAll(t);
        await _tap(t, find.text('Cancel'));
        await _tap(t, find.byTooltip('More: report a delay'));
        await _tap(t, find.text('Report a delay'));
        await _scrollAll(t);
        await _tap(t, find.text('Needs another trade'));
        await _tap(t, find.text('Cancel'));
      });
      fakeServer.respond = (o) => o.path.startsWith('/job-orders/j') ? job('ASSIGNED', answer: 'PENDING') : null;
      await checkScreen(t, 'Decline sheet', () => const TechJobScreen(jobId: 'j1'), act: (t) async {
        await _tap(t, find.text('Decline'));
        await _tap(t, find.text('Too many jobs'));
        await _scrollAll(t);
      });
    });

    testWidgets('Notifications', (t) async {
      await checkScreen(t, 'Notifications', () => const TechNotificationsScreen());
    });

    testWidgets('Skills setup and its results', (t) async {
      fakeServer.respond = (o) => o.method == 'POST' && o.path == '/technicians/survey'
          ? {
              'results': [
                {'name': 'Electrical', 'score': 88, 'qualified': true},
                {'name': 'Mechanical', 'score': 54, 'qualified': true},
                {'name': 'Plumbing', 'score': 12, 'qualified': false},
              ]
            }
          : null;
      await checkScreen(t, 'Skills setup', () => const SkillsSurveyScreen(), act: (t) async {
        await _tap(t, find.textContaining('Next:'));
        await _tap(t, find.text('Basic'));
        await _scrollAll(t);
        await _tap(t, find.textContaining('Next:'));
        await _tap(t, find.text('See my results'));
        await _scrollAll(t);
      });
    });
  });

  group('reporter', () {
    testWidgets('Home and every tab', (t) async {
      await checkScreen(t, 'Reporter home', () => const RepShell(), role: 'REPORTER', act: (t) async {
        for (final tab in ['My Reports', 'Profile']) {
          await _tap(t, find.text(tab).last);
          await _scrollAll(t);
        }
      });
    });

    testWidgets('New report: all four steps and the sent screen', (t) async {
      fakeServer.respond = (o) {
        if (o.method != 'POST') return null;
        if (o.path == '/reports') return report(status: 'SUBMITTED');
        if (o.path == '/job-order-forms') return {'formNo': 'JOF-2026-0099'};
        return null;
      };
      await checkScreen(t, 'New report', () => const RepNewReportScreen(recent: [longPlace, shortPlace]), role: 'REPORTER',
          act: (t) async {
        await _tap(t, find.text('New Building · Department of Management Entrepreneurship Cluster Faculty Room'));
        await _tap(t, find.text('Next'));
        await _tap(t, find.text('Wiring / Outlet'));
        await t.enterText(find.byType(TextField).first, 'The outlet sparks and smells burnt since this morning.');
        await _tap(t, find.text('Gallery'));
        await _scrollAll(t);
        await _tap(t, find.text('Next'));
        await _tap(t, find.text('Yes').first);
        await _tap(t, find.text('No').last);
        await _tap(t, find.text('11 to 50'));
        await _scrollAll(t);
        await _tap(t, find.text('Next: Job Order Form'));
        await _scrollAll(t);
        // sign and send
        final pad = find.bySemanticsLabel(RegExp('Signature box'));
        await t.ensureVisible(pad);
        final g = await t.startGesture(t.getTopLeft(pad) + const Offset(20, 30));
        for (var i = 0; i < 20; i++) {
          await g.moveBy(const Offset(8, 2));
        }
        await g.up();
        await _tap(t, find.text('I certify this request is true and correct.'));
        await _tap(t, find.text('Sign and send report'));
        await _scrollAll(t);
      });
    });

    testWidgets('Report detail, being fixed', (t) async {
      await checkScreen(t, 'Report detail', () => const RepReportDetailScreen(reportId: 'r1'), role: 'REPORTER');
    });

    testWidgets('Report detail, rate the repair', (t) async {
      fakeServer.respond = (o) => o.path == '/reports/r1' ? report(status: 'CLOSED', form: form()) : null;
      await checkScreen(t, 'Rate sheet', () => const RepReportDetailScreen(reportId: 'r1', rate: true), role: 'REPORTER',
          act: (t) async {
        await _tap(t, find.bySemanticsLabel('4 stars'));
        await _tap(t, find.text('Neat work'));
        await _scrollAll(t);
      });
    });

    testWidgets('Job Order Form: fix and sign again, and its detail', (t) async {
      await checkScreen(t, 'Fix form', () => const RepFormScreen(reportId: 'r1'), role: 'REPORTER');
      await checkScreen(t, 'Form detail', () => const RepFormDetailScreen(formId: 'f1'), role: 'REPORTER');
      fakeServer.respond = (o) => o.path == '/job-order-forms/f1' ? form(status: 'RETURNED') : null;
      await checkScreen(t, 'Returned form detail', () => const RepFormDetailScreen(formId: 'f1'), role: 'REPORTER');
    });

    testWidgets('Sign in', (t) async {
      await checkScreen(t, 'Sign in', () => const LoginScreen(), role: 'REPORTER');
    });
  });
}
