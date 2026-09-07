import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { darkColors, lightColors, type ThemeColors } from '@/constants/colors';
import { shadows } from '@/constants/theme';
import { useSettingsStore } from '@/store/useSettingsStore';

export function useTheme(): {
  colors: ThemeColors;
  isDark: boolean;
  shadow: typeof shadows.light;
} {
  const systemScheme = useColorScheme();
  const theme = useSettingsStore((state) => state.settings.theme);
  const isDark = theme === 'system' ? systemScheme === 'dark' : theme === 'dark';

  return useMemo(
    () => ({
      colors: isDark ? darkColors : lightColors,
      isDark,
      shadow: isDark ? shadows.dark : shadows.light,
    }),
    [isDark]
  );
}
