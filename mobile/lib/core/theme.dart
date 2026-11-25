import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Colour tokens shared with the web dashboard. Widgets read them through
/// `context.c` so every screen follows the light / dark choice.
@immutable
class AppColors extends ThemeExtension<AppColors> {
  final Color bg, surface, surface2, hover, border, borderStrong;
  final Color text, text2, muted;
  final Color green, greenSoft, onGreenSoft, primaryButton;
  final Color danger, dangerSoft, warn, warnSoft, success, info;

  const AppColors({
    required this.bg,
    required this.surface,
    required this.surface2,
    required this.hover,
    required this.border,
    required this.borderStrong,
    required this.text,
    required this.text2,
    required this.muted,
    required this.green,
    required this.greenSoft,
    required this.onGreenSoft,
    required this.primaryButton,
    required this.danger,
    required this.dangerSoft,
    required this.warn,
    required this.warnSoft,
    required this.success,
    required this.info,
  });

  static const light = AppColors(
    bg: Color(0xFFF5F6F4),
    surface: Color(0xFFFFFFFF),
    surface2: Color(0xFFF8F9F7),
    hover: Color(0xFFEFF1EE),
    border: Color(0xFFE2E5E0),
    borderStrong: Color(0xFFCFD4CD),
    text: Color(0xFF17201A),
    text2: Color(0xFF3E4943),
    muted: Color(0xFF67736B),
    green: Color(0xFF1D6B37),
    greenSoft: Color(0xFFE8F1EA),
    onGreenSoft: Color(0xFF165429),
    primaryButton: Color(0xFF1D6B37),
    danger: Color(0xFFB8321F),
    dangerSoft: Color(0xFFFBECEA),
    warn: Color(0xFFA45A06),
    warnSoft: Color(0xFFFCF1E1),
    success: Color(0xFF2E9A55),
    info: Color(0xFF2F5FB3),
  );

  static const dark = AppColors(
    bg: Color(0xFF0F1311),
    surface: Color(0xFF161A18),
    surface2: Color(0xFF1A1F1C),
    hover: Color(0xFF222825),
    border: Color(0xFF29302C),
    borderStrong: Color(0xFF3A433E),
    text: Color(0xFFE6EBE7),
    text2: Color(0xFFC3CAC5),
    muted: Color(0xFF8F9A92),
    green: Color(0xFF6CC489),
    greenSoft: Color(0xFF1B2A20),
    onGreenSoft: Color(0xFF8ED3A5),
    primaryButton: Color(0xFF2A7643),
    danger: Color(0xFFF08473),
    dangerSoft: Color(0xFF2C1A17),
    warn: Color(0xFFE9A94F),
    warnSoft: Color(0xFF2B2216),
    success: Color(0xFF4FB874),
    info: Color(0xFF86A9EE),
  );

  @override
  AppColors copyWith() => this;

  @override
  AppColors lerp(ThemeExtension<AppColors>? other, double t) =>
      other is AppColors && t > 0.5 ? other : this;
}

extension AppColorsX on BuildContext {
  AppColors get c => Theme.of(this).extension<AppColors>() ?? AppColors.light;
}

/// App-wide look: neutral surfaces, flat outlined cards, CvSU green as the
/// single accent (primary actions, selection, links). Status colours are
/// kept for state only. Same tokens as the web dashboard.
class AppTheme {
  static ThemeData light() => _build(AppColors.light, Brightness.light);
  static ThemeData dark() => _build(AppColors.dark, Brightness.dark);

  static ThemeData _build(AppColors c, Brightness b) {
    final scheme = ColorScheme.fromSeed(seedColor: const Color(0xFF1D6B37), brightness: b).copyWith(
      primary: c.primaryButton,
      onPrimary: Colors.white,
      secondary: c.green,
      surface: c.surface,
      onSurface: c.text,
      onSurfaceVariant: c.muted,
      surfaceContainerLowest: c.surface,
      surfaceContainerLow: c.surface,
      surfaceContainer: c.surface,
      surfaceContainerHigh: c.surface,
      surfaceContainerHighest: c.hover,
      outline: c.borderStrong,
      outlineVariant: c.border,
      error: c.danger,
      surfaceTint: Colors.transparent,
      primaryContainer: c.greenSoft,
      onPrimaryContainer: c.onGreenSoft,
      secondaryContainer: c.greenSoft,
      onSecondaryContainer: c.onGreenSoft,
    );

    final shape8 = RoundedRectangleBorder(borderRadius: BorderRadius.circular(8));
    OutlineInputBorder line(Color color, [double w = 1]) => OutlineInputBorder(
        borderRadius: BorderRadius.circular(8), borderSide: BorderSide(color: color, width: w));

    return ThemeData(
      useMaterial3: true,
      brightness: b,
      colorScheme: scheme,
      extensions: [c],
      scaffoldBackgroundColor: c.bg,
      canvasColor: c.bg,
      dividerColor: c.border,
      dividerTheme: DividerThemeData(color: c.border, thickness: 1, space: 1),
      appBarTheme: AppBarTheme(
        backgroundColor: c.surface,
        foregroundColor: c.text,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleSpacing: 16,
        titleTextStyle: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: c.text),
        shape: Border(bottom: BorderSide(color: c.border)),
      ),
      cardTheme: CardThemeData(
        color: c.surface,
        elevation: 0,
        margin: const EdgeInsets.symmetric(vertical: 5),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
          side: BorderSide(color: c.border),
        ),
      ),
      textTheme: TextTheme(
        titleLarge: TextStyle(fontSize: 21, fontWeight: FontWeight.w600, color: c.text, height: 1.25),
        titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: c.text),
        titleSmall: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: c.muted, letterSpacing: 0.2),
        bodyLarge: TextStyle(fontSize: 15.5, color: c.text, height: 1.45),
        bodyMedium: TextStyle(fontSize: 14.5, color: c.text2, height: 1.4),
        bodySmall: TextStyle(fontSize: 13, color: c.muted),
        labelLarge: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600),
      ),
      iconTheme: IconThemeData(color: c.text2),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          shape: shape8,
          backgroundColor: c.primaryButton,
          foregroundColor: Colors.white,
          disabledBackgroundColor: c.hover,
          minimumSize: const Size(64, 48),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          shape: shape8,
          minimumSize: const Size(64, 48),
          foregroundColor: c.text,
          side: BorderSide(color: c.borderStrong),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(shape: shape8, foregroundColor: c.green),
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: c.primaryButton,
        foregroundColor: Colors.white,
        elevation: 2,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: c.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        labelStyle: TextStyle(color: c.muted),
        hintStyle: TextStyle(color: c.muted),
        border: line(c.borderStrong),
        enabledBorder: line(c.borderStrong),
        focusedBorder: line(c.green, 1.6),
        errorBorder: line(c.danger),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: c.surface,
        selectedColor: c.greenSoft,
        side: BorderSide(color: c.borderStrong),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
        labelStyle: TextStyle(fontSize: 14, color: c.text2),
        showCheckmark: false,
        padding: const EdgeInsets.symmetric(horizontal: 4),
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: SegmentedButton.styleFrom(
          selectedBackgroundColor: c.greenSoft,
          selectedForegroundColor: c.green,
          foregroundColor: c.text2,
          side: BorderSide(color: c.borderStrong),
          shape: shape8,
        ),
      ),
      tabBarTheme: TabBarThemeData(
        labelColor: c.text,
        unselectedLabelColor: c.muted,
        indicatorColor: c.green,
        dividerColor: c.border,
        labelStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
        unselectedLabelStyle: const TextStyle(fontWeight: FontWeight.w500, fontSize: 15),
      ),
      listTileTheme: ListTileThemeData(iconColor: c.muted, textColor: c.text),
      popupMenuTheme: PopupMenuThemeData(
        color: c.surface,
        elevation: 3,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10), side: BorderSide(color: c.border)),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: c.surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: c.surface,
        surfaceTintColor: Colors.transparent,
        showDragHandle: true,
        dragHandleColor: c.borderStrong,
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(color: c.green),
      snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    );
  }
}

/// Remembers light / dark on this phone. Dark is the default.
class ThemeController extends ChangeNotifier {
  static const _key = 'theme_mode';
  ThemeMode mode = ThemeMode.dark;

  bool get isDark => mode == ThemeMode.dark;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    mode = prefs.getString(_key) == 'light' ? ThemeMode.light : ThemeMode.dark;
  }

  Future<void> toggle() async {
    mode = isDark ? ThemeMode.light : ThemeMode.dark;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, isDark ? 'dark' : 'light');
  }
}

/// Sun / moon button for the top bar: switches between dark and light.
class ThemeToggleButton extends StatelessWidget {
  const ThemeToggleButton({super.key});

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>();
    return IconButton(
      tooltip: t.isDark ? 'Switch to light mode' : 'Switch to dark mode',
      icon: Icon(t.isDark ? Icons.light_mode_outlined : Icons.dark_mode_outlined),
      onPressed: t.toggle,
    );
  }
}
