// FACILITRACK v2 design kit for the technician app.
//
// A 1:1 port of the v2 design's stylesheet (`.v2` tokens and components):
// colours, type, icons and the shared pieces every technician screen uses.
// Technician screens wrap themselves in [V2Scope] so they get this look
// while the rest of the app keeps its own theme.
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:provider/provider.dart';

import '../../core/theme.dart';

/* ------------------------------------------------------------------ tokens */

@immutable
class V2Colors extends ThemeExtension<V2Colors> {
  final Color bg, s1, s2, s3, line, line2, tx, tx2, tx3;
  final Color ac, acf, acs, acl, red, reds, amb, ambs, blu, blus, vio, gry;
  final Color p1, p2, p3, p4;
  final bool dark;

  const V2Colors({
    required this.bg,
    required this.s1,
    required this.s2,
    required this.s3,
    required this.line,
    required this.line2,
    required this.tx,
    required this.tx2,
    required this.tx3,
    required this.ac,
    required this.acf,
    required this.acs,
    required this.acl,
    required this.red,
    required this.reds,
    required this.amb,
    required this.ambs,
    required this.blu,
    required this.blus,
    required this.vio,
    required this.gry,
    required this.dark,
    this.p1 = const Color(0xFFE0335C),
    this.p2 = const Color(0xFFD96A12),
    this.p3 = const Color(0xFF2F6FE0),
    this.p4 = const Color(0xFF5C6F65),
  });

  static const darkTokens = V2Colors(
    dark: true,
    bg: Color(0xFF0B110E),
    s1: Color(0xFF111A15),
    s2: Color(0xFF16211B),
    s3: Color(0xFF1B2821),
    line: Color(0xFF213028),
    line2: Color(0xFF2C3F35),
    tx: Color(0xFFE8F1EB),
    tx2: Color(0xFFA7BBAF),
    tx3: Color(0xFF73897C),
    ac: Color(0xFF3FCF82),
    acf: Color(0xFF1F9D57),
    acs: Color.fromRGBO(63, 207, 130, 0.12),
    acl: Color.fromRGBO(63, 207, 130, 0.35),
    red: Color(0xFFFF6F87),
    reds: Color.fromRGBO(255, 111, 135, 0.13),
    amb: Color(0xFFF2A54A),
    ambs: Color.fromRGBO(242, 165, 74, 0.13),
    blu: Color(0xFF74A9FF),
    blus: Color.fromRGBO(116, 169, 255, 0.13),
    vio: Color(0xFFAB8DFF),
    gry: Color(0xFF8DA197),
  );

  static const lightTokens = V2Colors(
    dark: false,
    bg: Color(0xFFF3F6F4),
    s1: Color(0xFFFFFFFF),
    s2: Color(0xFFF4F7F5),
    s3: Color(0xFFEEF3F0),
    line: Color(0xFFE2E9E5),
    line2: Color(0xFFD3DDD7),
    tx: Color(0xFF13251B),
    tx2: Color(0xFF4A5F53),
    tx3: Color(0xFF7C8F84),
    ac: Color(0xFF138A4A),
    acf: Color(0xFF15964F),
    acs: Color.fromRGBO(21, 150, 79, 0.1),
    acl: Color.fromRGBO(21, 150, 79, 0.35),
    red: Color(0xFFD42A52),
    reds: Color(0xFFFDECEF),
    amb: Color(0xFFC25F0B),
    ambs: Color(0xFFFDF1E4),
    blu: Color(0xFF2A64D6),
    blus: Color(0xFFEBF1FD),
    vio: Color(0xFFAB8DFF),
    gry: Color(0xFF66796E),
  );

  @override
  V2Colors copyWith() => this;

  @override
  V2Colors lerp(ThemeExtension<V2Colors>? other, double t) =>
      other is V2Colors && t > 0.5 ? other : this;
}

extension V2X on BuildContext {
  V2Colors get v => Theme.of(this).extension<V2Colors>() ?? V2Colors.darkTokens;
}

/// Plus Jakarta Sans, bundled with the app (see pubspec.yaml).
const v2Font = 'PlusJakartaSans';

TextStyle v2Text({
  double size = 14,
  FontWeight weight = FontWeight.w400,
  Color? color,
  double? spacing,
  double height = 1.5,
}) => TextStyle(
  fontFamily: v2Font,
  fontSize: size,
  fontWeight: weight,
  color: color,
  letterSpacing: spacing,
  height: height,
);

ThemeData v2ThemeData(V2Colors c) {
  final base = c.dark
      ? ThemeData.dark(useMaterial3: true)
      : ThemeData.light(useMaterial3: true);
  return base.copyWith(
    extensions: [c, c.dark ? AppColors.dark : AppColors.light],
    scaffoldBackgroundColor: c.bg,
    canvasColor: c.bg,
    colorScheme: base.colorScheme.copyWith(
      primary: c.acf,
      onPrimary: Colors.white,
      surface: c.s1,
      onSurface: c.tx,
      error: c.red,
    ),
    textTheme: base.textTheme.apply(
      fontFamily: v2Font,
      bodyColor: c.tx,
      displayColor: c.tx,
    ),
    textSelectionTheme: TextSelectionThemeData(
      cursorColor: c.ac,
      selectionColor: c.acl,
      selectionHandleColor: c.ac,
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: c.ac),
    dividerColor: c.line,
    popupMenuTheme: PopupMenuThemeData(
      color: c.s1,
      surfaceTintColor: Colors.transparent,
      textStyle: v2Text(size: 14, weight: FontWeight.w600, color: c.tx),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: c.line),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: c.s1,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
    ),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    datePickerTheme: DatePickerThemeData(
      backgroundColor: c.s1,
      surfaceTintColor: Colors.transparent,
      headerBackgroundColor: c.acf,
      headerForegroundColor: Colors.white,
    ),
  );
}

/// Gives its subtree the v2 look, following the app's light / dark choice.
class V2Scope extends StatelessWidget {
  final Widget child;
  const V2Scope({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    final dark = context.watch<ThemeController>().isDark;
    final c = dark ? V2Colors.darkTokens : V2Colors.lightTokens;
    return Theme(
      data: v2ThemeData(c),
      child: DefaultTextStyle.merge(
        style: v2Text(color: c.tx),
        child: child,
      ),
    );
  }
}

/* ------------------------------------------------------------------- type */

class H1 extends StatelessWidget {
  final String text;
  final double size;
  const H1(this.text, {super.key, this.size = 26});
  @override
  Widget build(BuildContext context) => Text(
    text,
    style: v2Text(
      size: size,
      weight: FontWeight.w800,
      spacing: -0.5,
      height: 1.2,
      color: context.v.tx,
    ),
  );
}

class H2 extends StatelessWidget {
  final String text;
  final double size;
  const H2(this.text, {super.key, this.size = 16});
  @override
  Widget build(BuildContext context) => Text(
    text,
    style: v2Text(
      size: size,
      weight: FontWeight.w700,
      spacing: -0.1,
      color: context.v.tx,
    ),
  );
}

class Meta extends StatelessWidget {
  final String text;
  final double size;
  final Color? color;
  final FontWeight weight;
  final TextAlign? align;
  const Meta(
    this.text, {
    super.key,
    this.size = 12.5,
    this.color,
    this.weight = FontWeight.w400,
    this.align,
  });
  @override
  Widget build(BuildContext context) => Text(
    text,
    textAlign: align,
    style: v2Text(size: size, color: color ?? context.v.tx3, weight: weight),
  );
}

class Sub extends StatelessWidget {
  final String text;
  final double size;
  final TextAlign? align;
  const Sub(this.text, {super.key, this.size = 14, this.align});
  @override
  Widget build(BuildContext context) => Text(
    text,
    textAlign: align,
    style: v2Text(size: size, color: context.v.tx2),
  );
}

/* ------------------------------------------------------------------ icons */

/// The design's stroke icons (24 x 24, 1.9 stroke), drawn from its SVG paths.
class V2Icons {
  static const bell =
      '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>';
  static const bolt = '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>';
  static const fan =
      '<circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 1-7 4-7 2 0 3 2 1.5 4L13.6 10.6M14 12c4 0 7 1 7 4 0 2-2 3-4 1.5l-3.6-3.9M12 14c0 4-1 7-4 7-2 0-3-2-1.5-4l3.9-3.6M10 12c-4 0-7-1-7-4 0-2 2-3 4-1.5l3.6 3.9"/>';
  static const inbox =
      '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>';
  static const clock = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
  static const chart = '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>';
  static const user =
      '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>';
  static const back = '<path d="M19 12H5M12 19l-7-7 7-7"/>';
  static const dots =
      '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>';
  static const pin =
      '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>';
  static const calendar =
      '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>';
  static const box =
      '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>';
  static const camera =
      '<rect x="3" y="6" width="18" height="14" rx="3"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l1.5-2h5L16 6"/>';
  static const pencil =
      '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>';
  static const check = '<path d="M20 6 9 17l-5-5"/>';
  static const plus = '<path d="M12 5v14M5 12h14"/>';
  static const close = '<path d="M18 6 6 18M6 6l12 12"/>';
  static const drop =
      '<path d="M12 3s7 7.5 7 12a7 7 0 0 1-14 0c0-4.5 7-12 7-12z"/>';
  static const building = '<path d="M3 21h18M5 21V8l7-5 7 5v13M10 21v-6h4v6"/>';
  static const eye =
      '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
  static const eyeOff =
      '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/>';
  static const info =
      '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>';
  static const alert =
      '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5h.01"/>';
  static const warning =
      '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>';
  static const send =
      '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>';
  static const cap =
      '<path d="M12 3 2 8l10 5 10-5z"/><path d="M6 10.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-5.5"/>';
  static const moon =
      '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>';
  static const lock =
      '<rect x="4" y="11" width="16" height="10" rx="3"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>';
  static const devices =
      '<rect x="2" y="4" width="14" height="11" rx="2"/><rect x="17" y="9" width="5" height="11" rx="1.5"/><path d="M6 19h6"/>';
  static const logout =
      '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3"/>';
  // reporter screens
  static const layers =
      '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>';
  static const door =
      '<path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17M3 21h18M15 12h.01"/>';
  static const chevronDown = '<path d="m6 9 6 6 6-6"/>';
  static const chair = '<path d="M6 3v10h12V3M6 13v8M18 13v8M6 17h12"/>';
  static const doc =
      '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>';
  static const wall =
      '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 15h18M9 4v5M15 9v6M9 15v5"/>';
  static const roller =
      '<rect x="3" y="3" width="15" height="6" rx="1.5"/><path d="M18 6h3v5H11v4"/><rect x="9" y="15" width="4" height="6" rx="1"/>';
  static const gate = '<path d="M4 21V5M20 21V5M4 9h16M4 15h16M9 9v6M14 9v6"/>';
  static const broom = '<path d="m14 4 6 6M9 13l-5 7h7l5-7M12 10l5 5"/>';
  static const image =
      '<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m21 15-4.5-4.5L7 19"/>';
  static const list =
      '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>';
  static const link =
      '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>';
  static const star =
      '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" fill="currentColor"/>';
  // trades the design has no icon for
  static const hammer =
      '<path d="M14 6 4 16l4 4 10-10"/><path d="M12 4l8 8 2-2-8-8z"/>';
  static const brush = '<path d="M14 4l6 6-8 8H6v-6z"/><path d="M4 20l2-2"/>';
  static const wrench =
      '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>';
  static const bricks =
      '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 12h18M9 5v7M15 12v7"/>';
}

class V2Icon extends StatelessWidget {
  final String paths;
  final double size;
  final Color? color;
  const V2Icon(this.paths, {super.key, this.size = 20, this.color});

  @override
  Widget build(BuildContext context) {
    final c = color ?? IconTheme.of(context).color ?? context.v.tx2;
    return SvgPicture.string(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">$paths</svg>',
      width: size,
      height: size,
      theme: SvgTheme(currentColor: c),
    );
  }
}

/// Icon and colour for a trade unit (the design's `.ic` squares).
({String icon, Color color}) tradeLook(String? trade) {
  switch ((trade ?? '').toLowerCase()) {
    case 'electrical':
      return (icon: V2Icons.bolt, color: const Color(0xFFD9711A));
    case 'mechanical':
      return (icon: V2Icons.fan, color: const Color(0xFF2F6FE0));
    case 'plumbing':
      return (icon: V2Icons.drop, color: const Color(0xFF12927A));
    case 'carpentry':
      return (icon: V2Icons.hammer, color: const Color(0xFF7B55D9));
    case 'masonry':
      return (icon: V2Icons.bricks, color: const Color(0xFFD6456A));
    case 'painting':
      return (icon: V2Icons.brush, color: const Color(0xFFD6456A));
    case 'welding':
      return (icon: V2Icons.bolt, color: const Color(0xFF4F6258));
    default:
      return (icon: V2Icons.wrench, color: const Color(0xFF4F6258));
  }
}

/// Icon and colour for an issue category (the reporter's category tiles).
({String icon, Color color}) categoryLook(String? category) {
  final n = (category ?? '').toLowerCase();
  const org = Color(0xFFD9711A),
      blu = Color(0xFF2F6FE0),
      pnk = Color(0xFFD6456A);
  const vio = Color(0xFF7B55D9),
      tea = Color(0xFF12927A),
      gry = Color(0xFF4F6258);
  if (n.contains('light') || n.contains('wiring') || n.contains('outlet')) {
    return (icon: V2Icons.bolt, color: org);
  }
  if (n.contains('fan') || n.contains('aircon')) {
    return (icon: V2Icons.fan, color: blu);
  }
  if (n.contains('leak')) return (icon: V2Icons.drop, color: pnk);
  if (n.contains('toilet') || n.contains('drain')) {
    return (icon: V2Icons.drop, color: blu);
  }
  if (n.contains('chair') || n.contains('table')) {
    return (icon: V2Icons.chair, color: vio);
  }
  if (n.contains('door') || n.contains('window')) {
    return (icon: V2Icons.door, color: vio);
  }
  if (n.contains('wall') || n.contains('ceiling')) {
    return (icon: V2Icons.wall, color: org);
  }
  if (n.contains('paint') || n.contains('mold')) {
    return (icon: V2Icons.roller, color: pnk);
  }
  if (n.contains('gate') || n.contains('railing')) {
    return (icon: V2Icons.gate, color: gry);
  }
  if (n.contains('clean') || n.contains('ground')) {
    return (icon: V2Icons.broom, color: tea);
  }
  return (icon: V2Icons.wrench, color: gry);
}

/// "Wiring / Outlet" from "Faulty Wiring / Outlet": the tile label.
String shortCategory(String name) {
  var n = name.replaceFirst(
    RegExp(r'^(Faulty|Broken|Damaged|Clogged|Cracked|Peeling)\s+'),
    '',
  );
  if (n.startsWith('Cleaning')) n = 'Cleaning';
  if (n == 'Lighting') return 'Lighting';
  return n;
}

/// 40 x 40 rounded square with a white icon.
class IconSquare extends StatelessWidget {
  final String icon;
  final Color color;
  final double size;
  final double radius;
  final double iconSize;
  const IconSquare(
    this.icon,
    this.color, {
    super.key,
    this.size = 40,
    this.radius = 12,
    this.iconSize = 20,
  });

  factory IconSquare.trade(String? trade) {
    final t = tradeLook(trade);
    return IconSquare(t.icon, t.color);
  }

  factory IconSquare.category(String? category, {double size = 40}) {
    final t = categoryLook(category);
    return IconSquare(
      t.icon,
      t.color,
      size: size,
      iconSize: size >= 40 ? 20 : 18,
    );
  }

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      color: color,
      borderRadius: BorderRadius.circular(radius),
    ),
    child: V2Icon(icon, size: iconSize, color: Colors.white),
  );
}

/* ---------------------------------------------------------------- buttons */

enum BtnKind { normal, pri, ghost, danger }

enum BtnSize { sm, md, lg }

class V2Button extends StatelessWidget {
  final String label;
  final String? icon;
  final VoidCallback? onPressed;
  final BtnKind kind;
  final BtnSize size;
  final bool block;
  final bool busy;

  const V2Button(
    this.label, {
    super.key,
    this.icon,
    this.onPressed,
    this.kind = BtnKind.normal,
    this.size = BtnSize.md,
    this.block = false,
    this.busy = false,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    final h = switch (size) {
      BtnSize.sm => 32.0,
      BtnSize.md => 40.0,
      BtnSize.lg => 52.0,
    };
    final r = switch (size) {
      BtnSize.sm => 10.0,
      BtnSize.md => 12.0,
      BtnSize.lg => 14.0,
    };
    final fs = switch (size) {
      BtnSize.sm => 13.0,
      BtnSize.md => 14.0,
      BtnSize.lg => 15.5,
    };
    final padH = size == BtnSize.sm ? 12.0 : 16.0;
    final (bg, border, fg) = switch (kind) {
      BtnKind.pri => (c.acf, c.acf, Colors.white),
      BtnKind.ghost => (Colors.transparent, Colors.transparent, c.ac),
      BtnKind.danger => (c.s2, c.line2, c.red),
      BtnKind.normal => (c.s2, c.line2, c.tx),
    };
    final enabled = onPressed != null && !busy;
    final content = Row(
      mainAxisSize: block ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (busy)
          SizedBox(
            width: 17,
            height: 17,
            child: CircularProgressIndicator(strokeWidth: 2, color: fg),
          )
        else if (icon != null)
          V2Icon(icon!, size: 17, color: fg),
        if (busy || icon != null) const SizedBox(width: 8),
        Flexible(
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: v2Text(
              size: fs,
              weight: FontWeight.w700,
              color: fg,
              height: 1.2,
            ),
          ),
        ),
      ],
    );
    return Opacity(
      opacity: onPressed == null && !busy ? 0.5 : 1,
      child: Material(
        color: bg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(r),
          side: BorderSide(color: border),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: enabled ? onPressed : null,
          child: Container(
            height: h,
            width: block ? double.infinity : null,
            padding: EdgeInsets.symmetric(horizontal: padH),
            alignment: Alignment.center,
            child: content,
          ),
        ),
      ),
    );
  }
}

/// 40 x 40 icon button (`.ib`), plain = no border or fill.
class V2IconButton extends StatelessWidget {
  final String icon;
  final String tooltip;
  final VoidCallback? onPressed;
  final bool plain;
  final Widget? badge;
  const V2IconButton(
    this.icon, {
    super.key,
    required this.tooltip,
    this.onPressed,
    this.plain = false,
    this.badge,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    return Tooltip(
      message: tooltip,
      child: Semantics(
        button: true,
        label: tooltip,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Material(
              color: plain ? Colors.transparent : c.s1,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: BorderSide(color: plain ? Colors.transparent : c.line),
              ),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: onPressed,
                child: SizedBox(
                  width: 40,
                  height: 40,
                  child: Center(child: V2Icon(icon, size: 19, color: c.tx2)),
                ),
              ),
            ),
            if (badge != null) Positioned(top: -4, right: -4, child: badge!),
          ],
        ),
      ),
    );
  }
}

/* ----------------------------------------------------------------- labels */

/// Solid priority label: P1 red, P2 orange, P3 blue, P4 grey.
class PriorityLabel extends StatelessWidget {
  final String? p;
  const PriorityLabel(this.p, {super.key});

  @override
  Widget build(BuildContext context) {
    if (p == null) return const SizedBox.shrink();
    final c = context.v;
    final bg = switch (p) {
      'P1' => c.p1,
      'P2' => c.p2,
      'P3' => c.p3,
      _ => c.p4,
    };
    return Semantics(
      label: 'Priority $p',
      child: Container(
        height: 20,
        constraints: const BoxConstraints(minWidth: 26),
        padding: const EdgeInsets.symmetric(horizontal: 6),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(6),
        ),
        child: Center(
          widthFactor: 1,
          child: Text(
            p!,
            style: v2Text(
              size: 11,
              weight: FontWeight.w800,
              color: Colors.white,
              spacing: 0.3,
              height: 1,
            ),
          ),
        ),
      ),
    );
  }
}

enum StKind { neutral, tech, work, wait, check, done }

/// Status as a coloured dot and a word (`.st`).
class StatusDot extends StatelessWidget {
  final String text;
  final StKind kind;
  const StatusDot(this.text, this.kind, {super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    final d = switch (kind) {
      StKind.neutral => c.gry,
      StKind.tech => c.blu,
      StKind.work => c.amb,
      StKind.wait => c.red,
      StKind.check => c.vio,
      StKind.done => c.ac,
    };
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: d, shape: BoxShape.circle),
        ),
        const SizedBox(width: 7),
        Flexible(
          child: Text(
            text,
            overflow: TextOverflow.ellipsis,
            style: v2Text(size: 13, weight: FontWeight.w600, color: c.tx2),
          ),
        ),
      ],
    );
  }
}

enum TagTone { neutral, good, bad, warn }

/// Rounded tag (`.tag`).
class V2Tag extends StatelessWidget {
  final String text;
  final TagTone tone;
  const V2Tag(this.text, {super.key, this.tone = TagTone.neutral});

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    final (bg, fg) = switch (tone) {
      TagTone.good => (c.acs, c.ac),
      TagTone.bad => (c.reds, c.red),
      TagTone.warn => (c.ambs, c.amb),
      TagTone.neutral => (c.s3, c.tx2),
    };
    // hugs its text: never stretches to the width of its parent
    return Container(
      constraints: const BoxConstraints(minHeight: 24),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Center(
        widthFactor: 1,
        heightFactor: 1,
        child: Text(
          text,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: v2Text(
            size: 12,
            weight: FontWeight.w600,
            color: fg,
            height: 1,
          ),
        ),
      ),
    );
  }
}

/// Small count bubble (`.count`), hot = green.
class CountBadge extends StatelessWidget {
  final int n;
  final bool hot;
  final double height;
  final double fontSize;
  const CountBadge(
    this.n, {
    super.key,
    this.hot = false,
    this.height = 20,
    this.fontSize = 11.5,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    return Container(
      height: height,
      constraints: BoxConstraints(minWidth: height == 20 ? 22 : height),
      padding: const EdgeInsets.symmetric(horizontal: 6),
      decoration: BoxDecoration(
        color: hot ? c.acf : c.s3,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Center(
        widthFactor: 1,
        child: Text(
          n > 99 ? '99+' : '$n',
          style: v2Text(
            size: fontSize,
            weight: FontWeight.w700,
            color: hot ? Colors.white : c.tx2,
            height: 1,
          ),
        ),
      ),
    );
  }
}

/// The red unread dot (`.dotc`).
class UnreadDot extends StatelessWidget {
  const UnreadDot({super.key});
  @override
  Widget build(BuildContext context) => Container(
    width: 12,
    height: 12,
    decoration: BoxDecoration(
      color: context.v.red,
      shape: BoxShape.circle,
      border: Border.all(color: context.v.s1, width: 2),
    ),
  );
}

String initials(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((p) => p.isNotEmpty)
      .toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) return parts.first[0].toUpperCase();
  return (parts.first[0] + parts.last[0]).toUpperCase();
}

class Avatar extends StatelessWidget {
  final String name;
  final double size;
  final Color color;
  const Avatar(
    this.name, {
    super.key,
    this.size = 28,
    this.color = const Color(0xFF2F6FE0),
  });

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    alignment: Alignment.center,
    decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    child: Text(
      initials(name),
      style: v2Text(
        size: size >= 44 ? 15 : 11,
        weight: FontWeight.w800,
        color: Colors.white,
        height: 1,
      ),
    ),
  );
}

/// Caps the item on the right of a row (a status, tag, date or count) so a
/// narrow phone with large text keeps room for the main text on the left.
Widget rowEnd(BuildContext context, Widget child, {double fraction = 0.38}) => ConstrainedBox(
  constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * fraction),
  child: child,
);

/* --------------------------------------------------------------- surfaces */

/// Mobile card (`.mc`): 18 px corners, 1 px line.
class MCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color? borderColor;
  final Color? color;
  final VoidCallback? onTap;
  const MCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.borderColor,
    this.color,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    return Material(
      color: color ?? c.s1,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(color: borderColor ?? c.line),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(padding: padding, child: child),
      ),
    );
  }
}

/// Rows inside a card separated by 1 px lines (`.mc` with padding 0).
class CardRows extends StatelessWidget {
  final List<Widget> rows;
  const CardRows(this.rows, {super.key});

  @override
  Widget build(BuildContext context) => MCard(
    padding: EdgeInsets.zero,
    child: Column(
      children: [
        for (var i = 0; i < rows.length; i++) ...[
          if (i > 0) Divider(height: 1, thickness: 1, color: context.v.line),
          rows[i],
        ],
      ],
    ),
  );
}

/// Grey (or amber) note with an optional icon (`.note`).
class Note extends StatelessWidget {
  final Widget child;
  final String? icon;
  final bool warn;
  const Note({super.key, required this.child, this.icon, this.warn = false});

  factory Note.text(String text, {String? icon, bool warn = false}) => Note(
    icon: icon,
    warn: warn,
    child: Builder(
      builder: (ctx) => Text(text, style: v2Text(size: 13.5, color: ctx.v.tx2)),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: warn ? c.ambs : c.s2,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (icon != null) ...[
            Padding(
              padding: const EdgeInsets.only(top: 1),
              child: V2Icon(icon!, size: 18, color: warn ? c.amb : c.tx3),
            ),
            const SizedBox(width: 10),
          ],
          Expanded(
            child: DefaultTextStyle.merge(
              style: v2Text(size: 13.5, color: c.tx2),
              child: child,
            ),
          ),
        ],
      ),
    );
  }
}

/// One line of facts with a leading icon (location, reporter, date ...).
class FactLine extends StatelessWidget {
  final String icon;
  final String text;
  const FactLine(this.icon, this.text, {super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: V2Icon(icon, size: 17, color: c.tx3),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(text, style: v2Text(size: 13.5, color: c.tx2)),
          ),
        ],
      ),
    );
  }
}

/// Photo, or the design's tinted placeholder (`.photo`).
class PhotoBox extends StatelessWidget {
  final String? url;
  final ImageProvider? image;
  final double? width;
  final double height;
  final String? label;
  final String icon;
  final bool dashed;
  final VoidCallback? onTap;
  const PhotoBox({
    super.key,
    this.url,
    this.image,
    this.width,
    required this.height,
    this.label,
    this.icon = V2Icons.camera,
    this.dashed = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    Widget placeholder() => Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        V2Icon(icon, size: 26, color: c.tx3),
        if (label != null) ...[
          const SizedBox(height: 6),
          Text(
            label!,
            style: v2Text(size: 12, weight: FontWeight.w600, color: c.tx3),
          ),
        ],
      ],
    );
    final img = image ?? (url != null ? NetworkImage(url!) : null);
    final box = Container(
      width: width ?? double.infinity,
      height: height,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: dashed ? Border.all(color: c.line2, width: 1.5) : null,
        color: dashed ? c.s2 : null,
        gradient: dashed
            ? null
            : LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                stops: const [0, 0.6, 1],
                colors: [
                  Color.lerp(c.s2, c.acf, 0.16)!,
                  c.s2,
                  Color.lerp(c.s2, const Color(0xFFD8AA28), 0.12)!,
                ],
              ),
      ),
      clipBehavior: Clip.antiAlias,
      child: img == null
          ? placeholder()
          : Image(
              image: img,
              width: width ?? double.infinity,
              height: height,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => placeholder(),
            ),
    );
    if (onTap == null) return box;
    return GestureDetector(onTap: onTap, child: box);
  }
}

/// Photo field: an empty box with a hint, or the chosen photo with a remove
/// button, and Camera / Gallery buttons under it.
class PhotoPicker extends StatelessWidget {
  final Uint8List? bytes;
  final String emptyText;
  final ValueChanged<ImageSource> onPick;
  final VoidCallback onRemove;
  final bool enabled;
  const PhotoPicker({
    super.key,
    required this.bytes,
    required this.emptyText,
    required this.onPick,
    required this.onRemove,
    this.enabled = true,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (bytes != null)
        Stack(children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: Image.memory(bytes!, height: 180, width: double.infinity, fit: BoxFit.cover),
          ),
          Positioned(
            top: 8,
            right: 8,
            child: V2IconButton(V2Icons.close, tooltip: 'Remove photo', onPressed: enabled ? onRemove : null),
          ),
        ])
      else
        Container(
          constraints: const BoxConstraints(minHeight: 104),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(
            color: c.s1,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: c.line2, width: 1.5),
          ),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            V2Icon(V2Icons.image, size: 26, color: c.tx3),
            const SizedBox(height: 6),
            Text(emptyText, textAlign: TextAlign.center, style: v2Text(size: 13, color: c.tx3)),
          ]),
        ),
      const SizedBox(height: 8),
      Row(children: [
        Expanded(
          child: V2Button('Camera',
              icon: V2Icons.camera, block: true, onPressed: enabled ? () => onPick(ImageSource.camera) : null),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: V2Button('Gallery',
              icon: V2Icons.image, block: true, onPressed: enabled ? () => onPick(ImageSource.gallery) : null),
        ),
      ]),
    ]);
  }
}

/// Takes a photo or picks one, resized so uploads stay small on campus Wi-Fi.
Future<XFile?> takePhoto(ImageSource source) =>
    ImagePicker().pickImage(source: source, maxWidth: 1600, maxHeight: 1600, imageQuality: 70);

/* ------------------------------------------------------------------ fields */

/// Label above a field (`.f`).
class V2Field extends StatelessWidget {
  final String label;
  final Widget child;
  const V2Field(this.label, {super.key, required this.child});

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(
        label,
        style: v2Text(
          size: 12.5,
          weight: FontWeight.w700,
          color: context.v.tx2,
        ),
      ),
      const SizedBox(height: 6),
      child,
    ],
  );
}

/// Text input (`.in`), with the focus ring of `.in.focus`.
class V2Input extends StatefulWidget {
  final TextEditingController controller;
  final String? hint;
  final int minLines;
  final bool multiline;
  final double? minHeight;
  final String? icon;
  final Widget? trailing;
  final bool obscure;
  final bool enabled;
  final TextInputType? keyboard;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final Iterable<String>? autofill;
  final int? maxLength;
  final bool autofocus;
  const V2Input({
    super.key,
    required this.controller,
    this.hint,
    this.minLines = 1,
    this.multiline = false,
    this.minHeight,
    this.icon,
    this.trailing,
    this.obscure = false,
    this.enabled = true,
    this.keyboard,
    this.onChanged,
    this.onSubmitted,
    this.autofill,
    this.maxLength,
    this.autofocus = false,
  });

  @override
  State<V2Input> createState() => _V2InputState();
}

class _V2InputState extends State<V2Input> {
  final focus = FocusNode();

  @override
  void initState() {
    super.initState();
    focus.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    final on = focus.hasFocus;
    return Container(
      constraints: BoxConstraints(
        minHeight: widget.minHeight ?? (widget.multiline ? 84 : 42),
      ),
      padding: EdgeInsets.symmetric(
        horizontal: 14,
        vertical: widget.multiline ? 11 : 0,
      ),
      decoration: BoxDecoration(
        color: on ? c.s2 : c.s3,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: on ? c.acf : c.line),
        boxShadow: on ? [BoxShadow(color: c.acs, spreadRadius: 3)] : null,
      ),
      child: Row(
        crossAxisAlignment: widget.multiline
            ? CrossAxisAlignment.start
            : CrossAxisAlignment.center,
        children: [
          if (widget.icon != null) ...[
            V2Icon(widget.icon!, size: 17, color: c.tx3),
            const SizedBox(width: 10),
          ],
          Expanded(
            child: TextField(
              controller: widget.controller,
              focusNode: focus,
              enabled: widget.enabled,
              obscureText: widget.obscure,
              autofocus: widget.autofocus,
              keyboardType:
                  widget.keyboard ??
                  (widget.multiline ? TextInputType.multiline : null),
              minLines: widget.multiline ? 3 : 1,
              maxLines: widget.multiline ? 8 : 1,
              maxLength: widget.maxLength,
              autofillHints: widget.autofill,
              onChanged: widget.onChanged,
              onSubmitted: widget.onSubmitted,
              style: v2Text(size: 14, color: c.tx),
              decoration: InputDecoration(
                isCollapsed: true,
                border: InputBorder.none,
                counterText: '',
                contentPadding: EdgeInsets.symmetric(
                  vertical: widget.multiline ? 0 : 12,
                ),
                hintText: widget.hint,
                hintStyle: v2Text(size: 14, color: c.tx3),
              ),
            ),
          ),
          ?widget.trailing,
        ],
      ),
    );
  }
}

/// Tappable pill choice (`.chip`).
class V2Chip extends StatelessWidget {
  final String label;
  final bool on;
  final VoidCallback onTap;
  const V2Chip(this.label, {super.key, required this.on, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    return Semantics(
      selected: on,
      button: true,
      child: Material(
        color: on ? c.acs : Colors.transparent,
        shape: StadiumBorder(side: BorderSide(color: on ? c.acl : c.line2)),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Container(
            height: 34,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            alignment: Alignment.center,
            child: Text(
              label,
              // a long room name stays on one line, shortened with "..."
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: v2Text(
                size: 13.5,
                weight: FontWeight.w600,
                color: on ? c.ac : c.tx2,
                height: 1,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Segmented control (`.seg`), full width.
class Seg<T> extends StatelessWidget {
  final List<(T, String)> options;
  final T selected;
  final ValueChanged<T> onChanged;
  const Seg({
    super.key,
    required this.options,
    required this.selected,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: c.s1,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: c.line),
      ),
      child: Row(
        children: [
          for (var i = 0; i < options.length; i++) ...[
            if (i > 0) const SizedBox(width: 2),
            Expanded(
              child: Semantics(
                selected: options[i].$1 == selected,
                button: true,
                child: GestureDetector(
                  onTap: () => onChanged(options[i].$1),
                  child: Container(
                    height: 32,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: options[i].$1 == selected
                          ? c.s3
                          : Colors.transparent,
                      borderRadius: BorderRadius.circular(9),
                      border: options[i].$1 == selected
                          ? Border.all(color: c.line2)
                          : null,
                    ),
                    child: Text(
                      options[i].$2,
                      style: v2Text(
                        size: 13,
                        weight: FontWeight.w600,
                        color: options[i].$1 == selected ? c.tx : c.tx2,
                        height: 1,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Step progress bars (`.bars`).
class StepBars extends StatelessWidget {
  final int total;
  final int done;
  const StepBars({super.key, required this.total, required this.done});

  @override
  Widget build(BuildContext context) => Row(
    children: [
      for (var i = 0; i < total; i++) ...[
        if (i > 0) const SizedBox(width: 6),
        Expanded(
          child: Container(
            height: 6,
            decoration: BoxDecoration(
              color: i < done ? context.v.acf : context.v.s3,
              borderRadius: BorderRadius.circular(99),
            ),
          ),
        ),
      ],
    ],
  );
}

/// One timeline entry (`.tl > div`).
class TimelineEntry {
  final String title;
  final String when;
  final String? text;
  final Color? dot;
  final Widget? extra;
  const TimelineEntry(this.title, this.when, {this.text, this.dot, this.extra});
}

class V2Timeline extends StatelessWidget {
  final List<TimelineEntry> entries;
  const V2Timeline(this.entries, {super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    return Column(
      children: [
        for (var i = 0; i < entries.length; i++)
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(
                  width: 26,
                  child: Stack(
                    children: [
                      if (i < entries.length - 1)
                        Positioned(
                          left: 5,
                          top: 18,
                          bottom: 0,
                          child: Container(width: 2, color: c.line),
                        ),
                      Positioned(
                        left: 0,
                        top: 5,
                        child: Container(
                          width: 12,
                          height: 12,
                          decoration: BoxDecoration(
                            color: c.s1,
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: entries[i].dot ?? c.line2,
                              width: 2,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: Padding(
                    padding: EdgeInsets.only(
                      bottom: i < entries.length - 1 ? 18 : 0,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                entries[i].title,
                                style: v2Text(
                                  size: 14,
                                  weight: FontWeight.w700,
                                  color: c.tx,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Flexible(
                              child: Text(
                                entries[i].when,
                                textAlign: TextAlign.right,
                                style: v2Text(size: 12.5, color: c.tx3),
                              ),
                            ),
                          ],
                        ),
                        if (entries[i].text != null &&
                            entries[i].text!.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: Text(
                              entries[i].text!,
                              style: v2Text(size: 13.5, color: c.tx2),
                            ),
                          ),
                        ?entries[i].extra,
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

/* --------------------------------------------------------- mobile shell */

/// Screen top bar (`.m-top`).
class MTop extends StatelessWidget {
  final List<Widget> children;
  final EdgeInsets padding;
  const MTop({
    super.key,
    required this.children,
    this.padding = const EdgeInsets.fromLTRB(20, 18, 20, 14),
  });

  @override
  Widget build(BuildContext context) => SafeArea(
    bottom: false,
    child: Padding(
      padding: padding,
      child: Row(
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) const SizedBox(width: 10),
            children[i],
          ],
        ],
      ),
    ),
  );
}

/// Back button + bold title (+ optional trailing), as on every detail screen.
class BackTop extends StatelessWidget {
  final String title;
  final Widget? trailing;
  final bool centered;
  final VoidCallback? onBack;
  const BackTop(
    this.title, {
    super.key,
    this.trailing,
    this.centered = false,
    this.onBack,
  });

  @override
  Widget build(BuildContext context) => MTop(
    children: [
      V2IconButton(
        V2Icons.back,
        tooltip: 'Back',
        plain: true,
        onPressed: onBack ?? () => Navigator.maybePop(context),
      ),
      Expanded(
        child: Text(
          title,
          textAlign: centered ? TextAlign.center : TextAlign.start,
          style: v2Text(size: 16, weight: FontWeight.w700, color: context.v.tx),
        ),
      ),
      if (trailing != null)
        ConstrainedBox(
          constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.4),
          child: trailing,
        )
      else if (centered)
        const SizedBox(width: 40),
    ],
  );
}

/// Body padding and spacing (`.m-body`): 20 px sides, 16 px between blocks.
class MBody extends StatelessWidget {
  final List<Widget> children;
  final double bottom;
  final double top;
  final Future<void> Function()? onRefresh;
  const MBody({
    super.key,
    required this.children,
    this.bottom = 110,
    this.top = 0,
    this.onRefresh,
  });

  @override
  Widget build(BuildContext context) {
    final list = ListView(
      padding: EdgeInsets.fromLTRB(20, top, 20, bottom),
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        for (var i = 0; i < children.length; i++) ...[
          if (i > 0) const SizedBox(height: 16),
          children[i],
        ],
      ],
    );
    final body = Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: list,
      ),
    );
    if (onRefresh == null) return body;
    return RefreshIndicator(
      onRefresh: onRefresh!,
      color: context.v.ac,
      backgroundColor: context.v.s1,
      child: body,
    );
  }
}

/// Action bar pinned to the bottom (`.sbar`).
class StickyBar extends StatelessWidget {
  final List<Widget> children;
  const StickyBar({super.key, required this.children});

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    return Container(
      decoration: BoxDecoration(
        color: c.s1,
        border: Border(top: BorderSide(color: c.line)),
      ),
      padding: EdgeInsets.fromLTRB(
        20,
        12,
        20,
        28 + MediaQuery.of(context).padding.bottom * 0.5,
      ),
      child: Row(
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) const SizedBox(width: 10),
            children[i],
          ],
        ],
      ),
    );
  }
}

/// Bottom navigation (`.bn`).
class BottomNavItem {
  final String icon;
  final String label;
  final bool dot;
  const BottomNavItem(this.icon, this.label, {this.dot = false});
}

class V2BottomNav extends StatelessWidget {
  final List<BottomNavItem> items;
  final int index;
  final ValueChanged<int> onTap;
  const V2BottomNav({
    super.key,
    required this.items,
    required this.index,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    return Container(
      decoration: BoxDecoration(
        color: c.s1,
        border: Border(top: BorderSide(color: c.line)),
      ),
      padding: EdgeInsets.fromLTRB(
        8,
        8,
        8,
        20 + MediaQuery.of(context).padding.bottom * 0.5,
      ),
      child: Row(
        children: [
          for (var i = 0; i < items.length; i++)
            Expanded(
              child: Semantics(
                selected: i == index,
                button: true,
                label: items[i].label,
                child: InkResponse(
                  onTap: () => onTap(i),
                  radius: 36,
                  child: SizedBox(
                    height: 50,
                    child: Stack(
                      clipBehavior: Clip.none,
                      alignment: Alignment.topCenter,
                      children: [
                        if (i == index)
                          Positioned(
                            top: -8,
                            child: Container(
                              width: 28,
                              height: 3,
                              decoration: BoxDecoration(
                                color: c.ac,
                                borderRadius: const BorderRadius.vertical(
                                  bottom: Radius.circular(3),
                                ),
                              ),
                            ),
                          ),
                        Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            V2Icon(
                              items[i].icon,
                              size: 22,
                              color: i == index ? c.ac : c.tx3,
                            ),
                            const SizedBox(height: 4),
                            FittedBox(
                              fit: BoxFit.scaleDown,
                              child: Text(
                                items[i].label,
                                maxLines: 1,
                                // large system text would push the bar out
                                // of its 50 px row
                                textScaler: MediaQuery.textScalerOf(context)
                                    .clamp(maxScaleFactor: 1.3),
                                style: v2Text(
                                  size: 11.5,
                                  weight: FontWeight.w600,
                                  color: i == index ? c.ac : c.tx3,
                                  height: 1.2,
                                ),
                              ),
                            ),
                          ],
                        ),
                        if (items[i].dot)
                          const Positioned(
                            top: -4,
                            right: 0,
                            left: 26,
                            child: Center(child: UnreadDot()),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/* ------------------------------------------------------------------ sheets */

/// Bottom sheet in the design's style (`.scrim` + `.sheet` + `.handle`).
/// [build] returns the sheet's blocks; they are spaced 16 px apart.
///
/// Text controllers used in the sheet must be disposed in [onDispose], not
/// after awaiting this call: the returned future completes as soon as the
/// sheet starts closing (e.g. swiped down), while its text fields are still
/// on screen for the closing animation and still use their controllers.
Future<T?> showV2Sheet<T>(
  BuildContext context,
  List<Widget> Function(BuildContext ctx, StateSetter setSheet) build, {
  VoidCallback? onDispose,
}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    // the sheet draws the design's own handle; the app theme would add a
    // second, Material one above it
    showDragHandle: false,
    backgroundColor: Colors.transparent,
    barrierColor: const Color.fromRGBO(4, 10, 7, 0.6),
    builder: (_) => DisposeOnUnmount(
      onDispose: onDispose,
      child: V2Scope(
        child: StatefulBuilder(
          builder: (ctx, setSheet) {
            final c = ctx.v;
            final blocks = build(ctx, setSheet);
            return Padding(
              padding: EdgeInsets.only(
                bottom: MediaQuery.of(ctx).viewInsets.bottom,
              ),
              child: Container(
                decoration: BoxDecoration(
                  color: c.s1,
                  borderRadius: const BorderRadius.vertical(
                    top: Radius.circular(24),
                  ),
                  border: Border(top: BorderSide(color: c.line2)),
                ),
                child: SingleChildScrollView(
                  padding: EdgeInsets.fromLTRB(
                    20,
                    10,
                    20,
                    28 + MediaQuery.of(ctx).padding.bottom * 0.5,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Center(
                        child: Container(
                          width: 36,
                          height: 4,
                          decoration: BoxDecoration(
                            color: c.line2,
                            borderRadius: BorderRadius.circular(4),
                          ),
                        ),
                      ),
                      for (final b in blocks) ...[
                        const SizedBox(height: 16),
                        b,
                      ],
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    ),
  );
}

/// Runs [onDispose] once its subtree has left the screen for good (a sheet
/// or dialog after its closing animation). Use it to dispose the text
/// controllers of a sheet or dialog.
class DisposeOnUnmount extends StatefulWidget {
  final VoidCallback? onDispose;
  final Widget child;
  const DisposeOnUnmount({super.key, required this.onDispose, required this.child});

  @override
  State<DisposeOnUnmount> createState() => _DisposeOnUnmountState();
}

class _DisposeOnUnmountState extends State<DisposeOnUnmount> {
  @override
  void dispose() {
    widget.onDispose?.call();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// Sheet heading: 20 px title with a meta line under it.
class SheetHead extends StatelessWidget {
  final String title;
  final String meta;
  const SheetHead(this.title, this.meta, {super.key});

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [H2(title, size: 20), const SizedBox(height: 2), Meta(meta)],
  );
}

/* ----------------------------------------------------------------- helpers */

void v2Snack(BuildContext context, String message) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
}

const _monthShort = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const _weekdays = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/// "Nov 27" (calendar day of a UTC-midnight date).
String shortDay(Object? iso) {
  final d = DateTime.tryParse('${iso ?? ''}');
  if (d == null) return '';
  final u = d.toUtc();
  return '${_monthShort[u.month - 1]} ${u.day}';
}

/// "Nov 27" for an instant, in local time.
String shortLocalDay(Object? iso) {
  final d = DateTime.tryParse('${iso ?? ''}');
  if (d == null) return '';
  final l = d.toLocal();
  return '${_monthShort[l.month - 1]} ${l.day}';
}

String monthName(int m) => const [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
][m - 1];

/// "Thursday, Nov 26".
String longToday() {
  final n = DateTime.now();
  return '${_weekdays[n.weekday - 1]}, ${_monthShort[n.month - 1]} ${n.day}';
}

/// "Yesterday", "Today" or "Nov 24".
String relativeDay(Object? iso) {
  final d = DateTime.tryParse('${iso ?? ''}');
  if (d == null) return '';
  final l = d.toLocal();
  final now = DateTime.now();
  final days = DateTime(
    now.year,
    now.month,
    now.day,
  ).difference(DateTime(l.year, l.month, l.day)).inDays;
  if (days == 0) return 'Today';
  if (days == 1) return 'Yesterday';
  return '${_monthShort[l.month - 1]} ${l.day}';
}

/// Whole days from today to a UTC-midnight target date (negative = past).
int? daysUntil(Object? iso) {
  final d = DateTime.tryParse('${iso ?? ''}');
  if (d == null) return null;
  final now = DateTime.now();
  final today = DateTime.utc(now.year, now.month, now.day);
  final t = d.toUtc();
  return DateTime.utc(t.year, t.month, t.day).difference(today).inDays;
}

/// "1.1 days" from hours.
String daysText(num hours) {
  final d = hours / 24;
  return '${d.toStringAsFixed(1)} days';
}
