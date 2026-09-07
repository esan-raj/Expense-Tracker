import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ThemeCustomizer } from '@/components/theme/ThemeCustomizer';
import { useTheme } from '@/hooks/useTheme';
import { ACCENT_PRESETS } from '@/utils/accent';
import type { ThemePreference } from '@/types';

const options: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function AppearanceScreen() {
  const { colors, appearance, setAppearance, accentPreset } = useTheme();
  const [open, setOpen] = useState(false);
  const presetLabel = ACCENT_PRESETS.find((item) => item.id === accentPreset)?.label ?? 'Custom';

  return (
    <Screen scroll>
      <Text style={[styles.copy, { color: colors.textSecondary }]}>
        Dark and light themes keep the same accent. Surfaces stay calm; the accent is used for actions and highlights.
      </Text>
      <Card elevated={false}>
        <View style={styles.list}>
          {options.map((item) => (
            <Button
              key={item.value}
              title={item.label}
              variant={appearance === item.value ? 'primary' : 'secondary'}
              onPress={() => void setAppearance(item.value)}
            />
          ))}
        </View>
      </Card>
      <Card elevated={false}>
        <Text style={[styles.label, { color: colors.textPrimary }]}>Accent</Text>
        <Text style={{ color: colors.textSecondary, marginBottom: 12 }}>{presetLabel}</Text>
        <Button title="Customize theme" onPress={() => setOpen(true)} />
      </Card>
      <ThemeCustomizer visible={open} onClose={() => setOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  copy: { marginBottom: 16, lineHeight: 22 },
  list: { gap: 10 },
  label: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
});
