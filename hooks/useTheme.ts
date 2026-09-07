import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { shadows } from '@/constants/theme';
import { useSettingsStore } from '@/store/useSettingsStore';
import { buildThemeColors } from '@/utils/themeColors';
import type { AccentPreset, ThemePreference } from '@/types';
import type { ThemeColors } from '@/constants/colors';

export function useTheme(): {
  colors: ThemeColors;
  isDark: boolean;
  shadow: typeof shadows.light;
  appearance: ThemePreference;
  accentPreset: AccentPreset;
  accentColor: string;
  setAppearance: (theme: ThemePreference) => Promise<void>;
  setAccent: (preset: AccentPreset, customHex?: string) => Promise<void>;
} {
  const systemScheme = useColorScheme();
  const theme = useSettingsStore((state) => state.settings.theme);
  const accentPreset = useSettingsStore((state) => state.settings.accentPreset);
  const accentColor = useSettingsStore((state) => state.settings.accentColor);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const setAccent = useSettingsStore((state) => state.setAccent);
  const isDark = theme === 'system' ? systemScheme === 'dark' : theme === 'dark';

  return useMemo(
    () => ({
      colors: buildThemeColors(isDark, accentPreset ?? 'emerald', accentColor ?? '#0E7C66'),
      isDark,
      shadow: isDark ? shadows.dark : shadows.light,
      appearance: theme,
      accentPreset: accentPreset ?? 'emerald',
      accentColor: accentColor ?? '#0E7C66',
      setAppearance: setTheme,
      setAccent,
    }),
    [isDark, theme, accentPreset, accentColor, setTheme, setAccent]
  );
}
