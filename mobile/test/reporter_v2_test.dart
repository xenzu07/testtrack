import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:facilitrack_mobile/core/theme.dart';
import 'package:facilitrack_mobile/features/reporter/rep_common.dart';
import 'package:facilitrack_mobile/features/tech/v2.dart';

Future<void> pump(WidgetTester tester, Widget child) async {
  await tester.pumpWidget(ChangeNotifierProvider.value(
    value: ThemeController(),
    child: MaterialApp(home: V2Scope(child: Scaffold(body: Padding(padding: const EdgeInsets.all(20), child: child)))),
  ));
}

void main() {
  group('what needs the reporter', () {
    test('a closed report without a rating asks to be rated', () {
      expect(needsRating({'status': 'CLOSED', 'feedback': null}), isTrue);
      expect(needsRating({'status': 'CLOSED', 'feedback': {'rating': 5}}), isFalse);
      // closed because it was linked to an earlier report: nothing to rate
      expect(needsRating({'status': 'CLOSED', 'feedback': null, 'duplicateOfId': 'r0'}), isFalse);
    });

    test('a returned or missing Job Order Form needs the reporter', () {
      expect(needsYou({'status': 'UNDER_REVIEW', 'jobOrderForm': {'status': 'RETURNED'}}), isTrue);
      expect(needsYou({'status': 'SUBMITTED', 'jobOrderForm': null, 'duplicateOfId': null}), isTrue);
      expect(needsYou({'status': 'ASSIGNED', 'jobOrderForm': {'status': 'APPROVED'}}), isFalse);
      // a linked report is handled with its main report: no form of its own
      expect(needsYou({'status': 'ASSIGNED', 'jobOrderForm': null, 'duplicateOfId': 'x'}), isFalse);
    });

    test('priority label follows the urgency', () {
      expect(priorityOf({'urgency': 'CRITICAL'}), 'P1');
      expect(priorityOf({'urgency': 'LOW'}), 'P4');
      expect(priorityOf({}), isNull);
    });

    test('a linked report shows the main report\'s job', () {
      final r = {
        'jobOrder': {'status': 'CANCELLED', 'technician': {'fullName': 'Old'}},
        'duplicateOf': {'jobOrder': {'technician': {'fullName': 'Ramon Cruz'}}},
      };
      expect(techName(r), 'Ramon Cruz');
    });
  });

  group('category tiles', () {
    test('short labels as on the tiles', () {
      expect(shortCategory('Faulty Wiring / Outlet'), 'Wiring / Outlet');
      expect(shortCategory('Broken Fan / Aircon'), 'Fan / Aircon');
      expect(shortCategory('Cleaning / Grounds'), 'Cleaning');
      expect(shortCategory('Water Leak'), 'Water Leak');
    });

    test('icons and colours per category', () {
      expect(categoryLook('Water Leak').icon, V2Icons.drop);
      expect(categoryLook('Damaged Chair / Table').icon, V2Icons.chair);
      expect(categoryLook('Faulty Lighting').icon, V2Icons.bolt);
    });
  });

  testWidgets('status words for the reporter', (tester) async {
    await pump(tester, Column(children: [
      reportStatus({'status': 'IN_PROGRESS', 'jobOrder': {'status': 'IN_PROGRESS', 'targetDate': '2026-11-27T00:00:00.000Z'}}, withTarget: true),
      reportStatus({'status': 'COMPLETED'}),
    ]));
    expect(find.text('Being Fixed · Target Nov 27'), findsOneWidget);
    expect(find.text('GSO Checking'), findsOneWidget);
  });

  testWidgets('a tag under a name hugs its text instead of filling the row', (tester) async {
    await pump(tester, const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      V2Tag('Student', tone: TagTone.good),
      Wrap(children: [V2Tag('Plumbing 69', tone: TagTone.good)]),
      PriorityLabel('P1'),
      CountBadge(3, hot: true),
    ]));
    // the room available: the screen minus the 20 px padding on each side
    final card = tester.getSize(find.byType(Scaffold)).width - 40;
    for (final t in ['Student', 'Plumbing 69', 'P1', '3']) {
      final w = tester.getSize(find.ancestor(of: find.text(t), matching: find.byType(Container)).first).width;
      expect(w, lessThan(card / 2), reason: '"$t" is $w wide in a $card wide column');
    }
  });

  testWidgets('Yes / No options pick one answer', (tester) async {
    bool? value;
    await pump(tester, StatefulBuilder(
      builder: (ctx, set) => OptGrid<bool>(
        options: const [(true, 'Yes'), (false, 'No')],
        value: value,
        onChanged: (v) => set(() => value = v),
      ),
    ));
    await tester.tap(find.text('No'));
    await tester.pump();
    expect(value, isFalse);
  });
}