import { useEffect, useState, createElement } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SpendWiseLogo } from '@/components/brand/SpendWiseLogo';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { ACCENT_PRESETS, normalizeHex } from '@/utils/accent';
import { radius, spacing } from '@/constants/theme';
import type { ThemePreference } from '@/types';

export function ThemeCustomizer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors, isDark, appearance, accentPreset, accentColor, setAppearance, setAccent } = useTheme();
  const { isDesktop } = useBreakpoint();
  const [hex, setHex] = useState(accentColor);

  useEffect(() => {
    setHex(accentColor);
  }, [accentColor]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.overlay, { backgroundColor: colors.overlay, justifyContent: isDesktop ? 'center' : 'flex-end' }]} onPress={onClose}>
        <Pressable
          onPress={() => undefined}
          style={[
            styles.sheet,
            isDark ? styles.desktopPad : undefined,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.border,
              alignSelf: Platform.OS === 'web' ? 'center' : 'stretch',
            },
          ]}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>Customize appearance</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>✕</Text>
            </Pressable>
          </View>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Accent color</Text>
          <View style={styles.swatches}>
            {ACCENT_PRESETS.map((item) => {
              const selected = accentPreset === item.id;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => void setAccent(item.id)}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  accessibilityState={{ selected }}
                  style={[
                    styles.swatch,
                    { backgroundColor: isDark ? item.dark : item.light, borderColor: selected ? colors.textPrimary : 'transparent' },
                  ]}
                />
              );
            })}
          </View>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Custom color</Text>
          <View style={styles.customRow}>
            {Platform.OS === 'web'
              ? createElement('input', {
                  type: 'color',
                  value: normalizeHex(hex) ?? accentColor,
                  onChange: (event: { target: { value: string } }) => {
                    const next = event.target.value;
                    setHex(next);
                    void setAccent('custom', next);
                  },
                  style: { width: 44, height: 44, border: 'none', background: 'transparent', cursor: 'pointer' },
                })
              : null}
            <TextInput
              value={hex}
              onChangeText={(value) => {
                setHex(value);
                const normalized = normalizeHex(value);
                if (normalized) void setAccent('custom', normalized);
              }}
              autoCapitalize="none"
              placeholder="#0E7C66"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Custom accent hex"
              style={[styles.hex, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}
            />
          </View>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Appearance</Text>
          <View style={styles.modes}>
            {(['dark', 'light', 'system'] as ThemePreference[]).map((item) => (
              <Pressable
                key={item}
                onPress={() => void setAppearance(item)}
                style={[
                  styles.mode,
                  {
                    backgroundColor: appearance === item ? colors.primaryMuted : colors.surfaceSecondary,
                    borderColor: appearance === item ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={{ color: colors.textPrimary, fontWeight: '700', textTransform: 'capitalize' }}>{item}</Text>
              </Pressable>
            ))}
          </View>

          <Card elevated={false} style={[styles.preview, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '700' }}>Preview</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <SpendWiseLogo size={28} notchColor={colors.surfaceSecondary} />
              <Text style={{ color: colors.textPrimary, fontWeight: '800' }}>SpendWise</Text>
            </View>
            <View style={[styles.previewBar, { backgroundColor: colors.primary }]} />
          </Card>

          <Button title="Done" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', padding: 16 },
  sheet: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    gap: 12,
    marginBottom: Platform.OS === 'web' ? undefined : 12,
  },
  desktopPad: {},
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '800' },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 4 },
  swatches: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hex: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: 16 },
  modes: { flexDirection: 'row', gap: 8 },
  mode: { flex: 1, minHeight: 44, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  preview: { gap: 4 },
  previewBar: { height: 8, borderRadius: 99, marginTop: 10 },
});
