import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';

/// Holds the strokes drawn on a [SignaturePad] and turns them into a PNG.
class SignatureController extends ChangeNotifier {
  final List<List<Offset>> _strokes = [];
  Size _size = Size.zero;

  bool get isEmpty => _strokes.isEmpty;

  /// A real signature, not a tap or a dot.
  bool get isUsable => _strokes.fold<int>(0, (n, s) => n + s.length) >= 15;

  void _start(Offset p) {
    _strokes.add([p]);
    notifyListeners();
  }

  void _extend(Offset p) {
    if (_strokes.isEmpty) return;
    _strokes.last.add(p);
    notifyListeners();
  }

  void clear() {
    _strokes.clear();
    notifyListeners();
  }

  /// Black ink on white, at twice the screen size for a sharp print.
  Future<Uint8List?> toPng() async {
    if (_strokes.isEmpty || _size.isEmpty) return null;
    const scale = 2.0;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder)..scale(scale);
    canvas.drawRect(Offset.zero & _size, Paint()..color = Colors.white);
    _paintStrokes(canvas, _strokes);
    final image = await recorder
        .endRecording()
        .toImage((_size.width * scale).round(), (_size.height * scale).round());
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    return data?.buffer.asUint8List();
  }
}

void _paintStrokes(Canvas canvas, List<List<Offset>> strokes, [Color color = Colors.black]) {
  final ink = Paint()
    ..color = color
    ..strokeWidth = 2.6
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round
    ..style = PaintingStyle.stroke;
  for (final s in strokes) {
    if (s.length == 1) {
      canvas.drawCircle(s.first, 1.3, ink..style = PaintingStyle.fill);
      ink.style = PaintingStyle.stroke;
      continue;
    }
    final path = Path()..moveTo(s.first.dx, s.first.dy);
    for (final p in s.skip(1)) {
      path.lineTo(p.dx, p.dy);
    }
    canvas.drawPath(path, ink);
  }
}

/// A box the requester signs in with a finger or stylus. [onSigning] tells
/// the parent when a finger is down, so the page can stop scrolling meanwhile.
class SignaturePad extends StatelessWidget {
  final SignatureController controller;
  final ValueChanged<bool>? onSigning;
  final bool enabled;
  final double height;
  // how the pad looks on screen; the saved PNG is always black on white
  final Color background;
  final Color borderColor;
  final Color ink;
  final Color hintColor;
  final double radius;
  final bool showLine;

  const SignaturePad({
    super.key,
    required this.controller,
    this.onSigning,
    this.enabled = true,
    this.height = 170,
    this.background = Colors.white,
    this.borderColor = const Color(0xFFBDBDBD),
    this.ink = Colors.black,
    this.hintColor = Colors.black26,
    this.radius = 8,
    this.showLine = true,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Signature box. Draw your signature with your finger.',
      child: Container(
        height: height,
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(radius),
          border: Border.all(color: borderColor, width: radius > 8 ? 1.5 : 1),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(radius),
          child: LayoutBuilder(builder: (context, box) {
            controller._size = Size(box.maxWidth, box.maxHeight);
            bool inside(Offset p) =>
                p.dx >= 0 && p.dy >= 0 && p.dx <= box.maxWidth && p.dy <= box.maxHeight;
            return Listener(
              behavior: HitTestBehavior.opaque,
              onPointerDown: !enabled
                  ? null
                  : (e) {
                      onSigning?.call(true);
                      controller._start(e.localPosition);
                    },
              onPointerMove: !enabled
                  ? null
                  : (e) {
                      if (inside(e.localPosition)) controller._extend(e.localPosition);
                    },
              onPointerUp: (_) => onSigning?.call(false),
              onPointerCancel: (_) => onSigning?.call(false),
              child: AnimatedBuilder(
                animation: controller,
                builder: (context, _) => CustomPaint(
                  painter: _PadPainter(controller._strokes, ink, showLine),
                  child: controller.isEmpty
                      ? Center(
                          child: Text('Sign here', style: TextStyle(color: hintColor, fontSize: 18)),
                        )
                      : const SizedBox.expand(),
                ),
              ),
            );
          }),
        ),
      ),
    );
  }
}

class _PadPainter extends CustomPainter {
  final List<List<Offset>> strokes;
  final Color ink;
  final bool line;
  _PadPainter(this.strokes, this.ink, this.line);

  @override
  void paint(Canvas canvas, Size size) {
    // signature line
    if (line) {
      final y = size.height - 28;
      canvas.drawLine(Offset(16, y), Offset(size.width - 16, y),
          Paint()..color = ink.withValues(alpha: 0.12)..strokeWidth = 1);
    }
    _paintStrokes(canvas, strokes, ink);
  }

  @override
  bool shouldRepaint(_PadPainter old) => true;
}
