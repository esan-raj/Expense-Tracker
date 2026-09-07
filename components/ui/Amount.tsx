import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { formatMoney } from '@/utils/currency';
import type { CurrencyCode, TransactionType } from '@/types';

interface AmountProps {
  minor: number;
  currency: CurrencyCode;
  type?: TransactionType | 'transfer';
  signed?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'hero';
  tone?: 'default' | 'income' | 'expense' | 'transfer' | 'muted';
  hidden?: boolean;
  style?: StyleProp<TextStyle>;
}

export function Amount({
  minor,
  currency,
  type,
  signed,
  size = 'md',
  tone,
  hidden,
  style,
}: AmountProps) {
  const { colors } = useTheme();
  const resolvedTone =
    tone ?? (type === 'income' ? 'income' : type === 'expense' ? 'expense' : type === 'transfer' ? 'transfer' : 'default');
  const color = {
    default: colors.textPrimary,
    income: colors.income,
    expense: colors.expense,
    transfer: colors.transfer,
    muted: colors.textSecondary,
  }[resolvedTone];
  const fontSize = { sm: 14, md: 16, lg: 22, hero: 32 }[size];
  const value =
    type && type !== 'transfer'
      ? formatMoney(minor, currency, { type })
      : formatMoney(minor, currency, signed ? { signed: true } : undefined);

  return (
    <Text
      style={[styles.amount, { color, fontSize }, style]}
      accessibilityLabel={hidden ? 'Balance hidden' : value}
    >
      {hidden ? '••••••' : value}
    </Text>
  );
}

const styles = StyleSheet.create({
  amount: {
    fontWeight: '700',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
});
