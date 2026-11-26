import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:facilitrack_mobile/core/theme.dart';
import 'package:facilitrack_mobile/core/ui.dart';

// The progress steps a reporter sees on a report.
Future<void> pumpSteps(WidgetTester tester, String status) => tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(body: Padding(padding: const EdgeInsets.all(16), child: ProgressSteps(status))),
      ),
    );

void main() {
  testWidgets('a verified (closed) report shows all six steps checked', (tester) async {
    await pumpSteps(tester, 'CLOSED');
    expect(find.byIcon(Icons.check), findsNWidgets(6));
    expect(find.text('6'), findsNothing);
    expect(find.text('Verified'), findsOneWidget);
  });

  testWidgets('a completed report checks four steps, Completed is current, Verified is still to come', (tester) async {
    await pumpSteps(tester, 'COMPLETED');
    expect(find.byIcon(Icons.check), findsNWidgets(4));
    expect(find.text('5'), findsOneWidget); // current step
    expect(find.text('6'), findsOneWidget);
  });

  testWidgets('a new report has nothing checked', (tester) async {
    await pumpSteps(tester, 'SUBMITTED');
    expect(find.byIcon(Icons.check), findsNothing);
  });

  testWidgets('a delayed job shows Delayed on the In progress step', (tester) async {
    await pumpSteps(tester, 'DELAYED');
    expect(find.text('Delayed'), findsOneWidget);
    expect(find.byIcon(Icons.check), findsNWidgets(3));
  });
}
