import 'package:flutter/material.dart';

/// Colours from the web app's design tokens (styles/index.css).
class AppColors {
  static const primary = Color(0xFF2F5BD3);
  static const brandFrom = Color(0xFF2847B5);
  static const brandTo = Color(0xFF5A3FD1);
  static const foreground = Color(0xFF1E2433);
  static const muted = Color(0xFF6B7280);
  static const border = Color(0xFFE4E7EE);
  static const app = Color(0xFFF6F8FB);
  static const card = Colors.white;

  static const info = Color(0xFF3B82F6);
  static const infoSoft = Color(0xFFE8F0FE);
  static const infoFg = Color(0xFF1D4ED8);
  static const success = Color(0xFF2E9E5B);
  static const successSoft = Color(0xFFE6F6EC);
  static const successFg = Color(0xFF15803D);
  static const warning = Color(0xFFE0A526);
  static const warningSoft = Color(0xFFFDF4E1);
  static const warningFg = Color(0xFFB45309);
  static const danger = Color(0xFFDC4B3F);
  static const dangerSoft = Color(0xFFFDECEA);
  static const dangerFg = Color(0xFFB91C1C);
  static const neutralSoft = Color(0xFFF1F3F6);

  static const brand = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [brandFrom, brandTo],
  );
}

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: AppColors.primary,
    primary: AppColors.primary,
    surface: Colors.white,
    error: AppColors.danger,
  );
  final border = OutlineInputBorder(
    borderRadius: BorderRadius.circular(10),
    borderSide: const BorderSide(color: AppColors.border),
  );
  return ThemeData(
    useMaterial3: true,
    // Bundled, so phones with a custom system font still look like the web app.
    fontFamily: 'Inter',
    colorScheme: scheme,
    scaffoldBackgroundColor: AppColors.app,
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.white,
      foregroundColor: AppColors.foreground,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      centerTitle: false,
      titleTextStyle: TextStyle(
          fontSize: 18, fontWeight: FontWeight.w600, color: AppColors.foreground),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: AppColors.border),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: border,
      enabledBorder: border,
      focusedBorder: border.copyWith(
          borderSide: const BorderSide(color: AppColors.primary, width: 1.6)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(64, 50),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(64, 50),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        side: const BorderSide(color: AppColors.border),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: AppColors.infoSoft,
      height: 66,
      labelTextStyle: WidgetStateProperty.resolveWith((s) => TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w500,
            color: s.contains(WidgetState.selected) ? AppColors.primary : AppColors.muted,
          )),
      iconTheme: WidgetStateProperty.resolveWith((s) => IconThemeData(
            size: 22,
            color: s.contains(WidgetState.selected) ? AppColors.primary : AppColors.muted,
          )),
    ),
    dividerTheme: const DividerThemeData(color: AppColors.border, space: 1),
  );
}
