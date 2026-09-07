import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { radius, spacing } from '@/constants/theme';

interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string> {
  label: string;
  value?: T;
  placeholder?: string;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  error?: string;
}

export function Select<T extends string>({
  label,
  value,
  placeholder = 'Select',
  options,
  onChange,
  error,
}: SelectProps<T>) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((item) => item.value === value);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[styles.field, { backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.border }]}
      >
        <Text style={{ color: selected ? colors.textPrimary : colors.textTertiary, fontSize: 16 }}>
          {selected?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
      </Pressable>
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={[styles.overlay, { backgroundColor: colors.overlay }]} onPress={() => setOpen(false)}>
          <View style={[styles.sheet, { backgroundColor: colors.surfaceElevated }]}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{label}</Text>
            <ScrollView style={styles.list}>
              {options.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  style={styles.option}
                >
                  <Text style={{ color: colors.textPrimary, fontSize: 16 }}>{option.label}</Text>
                  {option.value === value ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600' },
  field: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '70%' },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  list: { maxHeight: 360 },
  option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
