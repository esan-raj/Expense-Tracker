import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/store/useSettingsStore';
import type { ThemePreference } from '@/types';

const options: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function AppearanceScreen() {
  const { colors } = useTheme();
  const theme = useSettingsStore((state) => state.settings.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);

  return (
    <Screen scroll>
      <Text style={[styles.copy, { color: colors.textSecondary }]}>
        Dark mode uses its own semantic colors rather than a simple inversion.
      </Text>
      <Card>
        <View style={styles.list}>
          {options.map((item) => (
            <Button
              key={item.value}
              title={item.label}
              variant={theme === item.value ? 'primary' : 'secondary'}
              onPress={() => void setTheme(item.value)}
            />
          ))}
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  copy: { marginBottom: 16, lineHeight: 22 },
  list: { gap: 10 },
});
