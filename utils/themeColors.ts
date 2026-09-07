import { darkColors, lightColors, type ThemeColors } from '@/constants/colors';
import { mixHex, contrastForeground, resolveAccentHex, type AccentPresetId } from '@/utils/accent';

export function buildThemeColors(isDark: boolean, preset: AccentPresetId, accentColor: string): ThemeColors {
  const base = isDark ? darkColors : lightColors;
  const primary = resolveAccentHex(preset, accentColor, isDark);
  const onPrimary = contrastForeground(primary);
  const primaryMuted = isDark ? mixHex(primary, base.surface, 0.78) : mixHex(primary, '#FFFFFF', 0.86);
  const wash = isDark ? 0.07 : 0.045;

  return {
    ...base,
    background: mixHex(base.background, primary, wash),
    surface: isDark ? mixHex(base.surface, primary, 0.05) : base.surface,
    surfaceSecondary: mixHex(base.surfaceSecondary, primary, isDark ? 0.06 : 0.04),
    surfaceElevated: isDark ? mixHex(base.surfaceElevated, primary, 0.06) : base.surfaceElevated,
    border: mixHex(base.border, primary, 0.08),
    primary,
    primaryMuted,
    primarySoft: primaryMuted,
    onPrimary,
    tabBar: isDark ? mixHex(base.tabBar, primary, 0.05) : base.tabBar,
    progressTrack: mixHex(base.progressTrack, primary, 0.06),
  };
}
