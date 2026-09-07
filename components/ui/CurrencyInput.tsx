import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { radius, spacing } from '@/constants/theme';
import { useSettingsStore } from '@/store/useSettingsStore';
import { getCurrency } from '@/constants/currencies';

interface CurrencyInputProps {
  label?: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: string;
}

export function CurrencyInput({ label = 'Amount', value, onChangeText, error }: CurrencyInputProps) {
  const { colors } = useTheme();
  const currency = useSettingsStore((state) => getCurrency(state.settings.currency));

  return (
    <View style={styles.wrap}>
      {label ? <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text> : null}
      <View
        style={[
          styles.row,
          { backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.border },
        ]}
      >
        <Text style={[styles.symbol, { color: colors.textSecondary }]}>{currency.symbol}</Text>
        <TextInput
          value={value}
          onChangeText={(text) => onChangeText(text.replace(/[^\d.]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel={label}
          style={[styles.input, { color: colors.textPrimary }]}
        />
      </View>
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    minHeight: 72,
  },
  symbol: { fontSize: 28, fontWeight: '700', marginRight: 8 },
  input: { flex: 1, fontSize: 32, fontWeight: '700' },
  error: { fontSize: 13, fontWeight: '500' },
});
