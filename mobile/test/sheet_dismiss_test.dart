import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:facilitrack_mobile/core/theme.dart';
import 'package:facilitrack_mobile/features/tech/v2.dart';

// Regression: swiping the "Post an update" sheet down with the keyboard open
// threw "A TextEditingController was used after being disposed", followed by
// "'_dependents.isEmpty': is not true". The controller was disposed as soon
// as the sheet started closing; the keyboard closing then rebuilt the field.

class _Screen extends StatefulWidget {
  final bool dialog;
  const _Screen({this.dialog = false});
  @override
  State<_Screen> createState() => _ScreenState();
}

class _ScreenState extends State<_Screen> {
  final controllers = <TextEditingController>[];

  Future<void> open() async {
    final text = TextEditingController();
    controllers.add(text);
    if (widget.dialog) {
      await showDialog<void>(
        context: context,
        builder: (ctx) => DisposeOnUnmount(
          onDispose: text.dispose,
          child: AlertDialog(title: const Text('Post an update'), content: TextField(controller: text)),
        ),
      );
      return;
    }
    await showV2Sheet<void>(
      context,
      (ctx, setSheet) => [
        const SheetHead('Post an update', 'The reporter and the GSO see it.'),
        V2Field("What's happening?", child: V2Input(controller: text, multiline: true, onChanged: (_) => setSheet(() {}))),
        V2Button('Post update', kind: BtnKind.pri, size: BtnSize.lg, block: true, onPressed: () {}),
      ],
      onDispose: text.dispose,
    );
  }

  @override
  Widget build(BuildContext context) => V2Scope(
        child: Builder(
          builder: (context) => Scaffold(
            body: Column(children: [const BackTop('JO-2026-0001'), Expanded(child: MBody(children: [V2Button('open', onPressed: open)]))]),
          ),
        ),
      );
}

Future<void> openTypeAndDismiss(WidgetTester tester, {required bool dialog}) async {
  await tester.pumpWidget(ChangeNotifierProvider.value(
    value: ThemeController(),
    child: MaterialApp(home: _Screen(dialog: dialog)),
  ));
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();

  // typing, with the keyboard open
  tester.view.viewInsets = const FakeViewPadding(bottom: 300);
  addTearDown(tester.view.reset);
  await tester.pump();
  await tester.enterText(find.byType(TextField), 'Ballast on spotlight 2 is burnt');
  await tester.pump();

  if (dialog) {
    await tester.tapAt(const Offset(10, 10)); // outside the dialog
  } else {
    // a slow swipe down from the sheet's title
    final g = await tester.startGesture(tester.getCenter(find.text('Post an update')));
    for (var i = 0; i < 20; i++) {
      await g.moveBy(const Offset(0, 30));
      await tester.pump(const Duration(milliseconds: 16));
    }
    await g.up();
  }
  await tester.pump(const Duration(milliseconds: 16));
  // the keyboard goes away while it is still closing
  tester.view.viewInsets = FakeViewPadding.zero;
  for (var i = 0; i < 40; i++) {
    await tester.pump(const Duration(milliseconds: 16));
  }
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a sheet shows one drag handle, even under the app theme', (tester) async {
    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: ThemeController(),
      // the app theme turns on Material's drag handle for all sheets
      child: MaterialApp(theme: AppTheme.dark(), home: const _Screen()),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.text('Post an update'), findsOneWidget);
    expect(find.byWidgetPredicate((w) => w.runtimeType.toString() == '_DragHandle'), findsNothing);
  });

  testWidgets('swiping a sheet down while typing closes it cleanly', (tester) async {
    await openTypeAndDismiss(tester, dialog: false);
    expect(find.text('Post an update'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('dismissing a dialog while typing closes it cleanly', (tester) async {
    await openTypeAndDismiss(tester, dialog: true);
    expect(find.text('Post an update'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
