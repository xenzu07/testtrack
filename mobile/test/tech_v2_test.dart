import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:facilitrack_mobile/core/theme.dart';
import 'package:facilitrack_mobile/features/tech/tech_job_screen.dart';
import 'package:facilitrack_mobile/features/tech/v2.dart';

// The technician app's v2 pieces, rendered in both themes.
Future<void> pump(WidgetTester tester, Widget child, {bool dark = true}) async {
  final theme = ThemeController()..mode = dark ? ThemeMode.dark : ThemeMode.light;
  await tester.pumpWidget(
    ChangeNotifierProvider.value(
      value: theme,
      child: MaterialApp(
        home: V2Scope(child: Scaffold(body: Padding(padding: const EdgeInsets.all(20), child: child))),
      ),
    ),
  );
}

Map<String, dynamic> job(String status, {String? answer, List delays = const [], List logs = const []}) => {
      'status': status,
      'assignmentStatus': answer,
      'delays': delays,
      'report': {'logs': logs},
    };

void main() {
  group('job status line', () {
    testWidgets('a new offer is a "New job for you" tag', (tester) async {
      await pump(tester, jobStatus(job('ASSIGNED', answer: 'PENDING')));
      expect(find.text('New job for you'), findsOneWidget);
    });

    testWidgets('accepted, in progress, paused, checking and closed read as in the design', (tester) async {
      await pump(
        tester,
        Column(children: [
          jobStatus(job('ASSIGNED', answer: 'ACCEPTED')),
          jobStatus(job('IN_PROGRESS', answer: 'ACCEPTED')),
          jobStatus(job('DELAYED', answer: 'ACCEPTED', delays: [
            {'reason': 'Waiting for materials', 'resolvedAt': null},
          ])),
          jobStatus(job('COMPLETED')),
          jobStatus(job('CLOSED')),
        ]),
      );
      expect(find.text('Accepted · Not Started'), findsOneWidget);
      expect(find.text("You're working on this"), findsOneWidget);
      expect(find.text('Paused · waiting for materials'), findsOneWidget);
      expect(find.text('Waiting for the GSO check'), findsOneWidget);
      expect(find.text('Closed'), findsOneWidget);
    });

    testWidgets('on Home an in-progress job shows its day', (tester) async {
      final started = DateTime.now().subtract(const Duration(days: 2)).toIso8601String();
      await pump(
        tester,
        jobStatus(
          job('IN_PROGRESS', answer: 'ACCEPTED', logs: [
            {'oldStatus': 'ASSIGNED', 'newStatus': 'IN_PROGRESS', 'createdAt': started},
          ]),
          long: false,
        ),
      );
      expect(find.text('In Progress · Day 3'), findsOneWidget);
    });
  });

  group('v2 components', () {
    for (final dark in [true, false]) {
      testWidgets('render in ${dark ? 'dark' : 'light'} mode', (tester) async {
        await pump(
          tester,
          Column(children: [
            const Row(children: [PriorityLabel('P1'), V2Tag('New job for you', tone: TagTone.good)]),
            const Seg<int>(options: [(7, '7 days'), (30, '30 days')], selected: 30, onChanged: _noop),
            const StepBars(total: 6, done: 2),
            V2Button('Accept job', icon: V2Icons.check, kind: BtnKind.pri, onPressed: () {}),
            const V2Timeline([TimelineEntry('Started', 'Nov 24', text: 'Checked the wiring.')]),
          ]),
          dark: dark,
        );
        expect(find.text('P1'), findsOneWidget);
        expect(find.text('30 days'), findsOneWidget);
        expect(find.text('Accept job'), findsOneWidget);
        expect(find.text('Checked the wiring.'), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('a button without an action is dimmed, one with an action is not', (tester) async {
      await pump(tester, const V2Button('Decline job', kind: BtnKind.danger));
      expect(tester.widget<Opacity>(find.ancestor(of: find.text('Decline job'), matching: find.byType(Opacity))).opacity, 0.5);
      await pump(tester, V2Button('Decline job', kind: BtnKind.danger, onPressed: () {}));
      expect(tester.widget<Opacity>(find.ancestor(of: find.text('Decline job'), matching: find.byType(Opacity))).opacity, 1);
    });
  });

  group('photo field in the update and finish sheets', () {
    // a 1 x 1 PNG
    final png = Uint8List.fromList([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
      0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
      0x00, 0x03, 0x01, 0x01, 0x00, 0xC9, 0xFE, 0x92, 0xEF, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
      0x44, 0xAE, 0x42, 0x60, 0x82,
    ]);

    testWidgets('empty: a hint box with Camera and Gallery buttons', (tester) async {
      ImageSource? asked;
      await pump(tester, PhotoPicker(
        bytes: null,
        emptyText: 'No photo yet. Show the update.',
        onPick: (s) => asked = s,
        onRemove: () {},
      ));
      expect(find.text('No photo yet. Show the update.'), findsOneWidget);
      expect(find.text('Add'), findsNothing);
      await tester.tap(find.text('Gallery'));
      expect(asked, ImageSource.gallery);
      await tester.tap(find.text('Camera'));
      expect(asked, ImageSource.camera);
    });

    testWidgets('with a photo: the photo shows and can be removed', (tester) async {
      var removed = false;
      await pump(tester, PhotoPicker(
        bytes: png,
        emptyText: 'No photo yet. Show the finished work.',
        onPick: (_) {},
        onRemove: () => removed = true,
      ));
      expect(find.text('No photo yet. Show the finished work.'), findsNothing);
      expect(find.byType(Image), findsOneWidget);
      await tester.tap(find.byTooltip('Remove photo'));
      expect(removed, isTrue);
    });
  });

  group('dates', () {
    test('target dates read as calendar days', () {
      expect(shortDay('2026-11-27T00:00:00.000Z'), 'Nov 27');
      expect(daysText(26.4), '1.1 days');
    });
  });
}

void _noop(int _) {}
