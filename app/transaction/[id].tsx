import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { CategoryIcon } from '@/components/categories/CategoryIcon';
import { transactionService } from '@/services/transactionService';
import { useTransactionStore } from '@/store/useTransactionStore';
import { useBudgetStore } from '@/store/useBudgetStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useTheme } from '@/hooks/useTheme';
import { formatMoney } from '@/utils/currency';
import { formatDisplayDate } from '@/utils/dates';
import { paymentMethodLabel } from '@/utils/constants';
import { toUserMessage } from '@/utils/errors';
import type { TransactionWithCategory } from '@/types';

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const currency = useSettingsStore((state) => state.settings.currency);
  const remove = useTransactionStore((state) => state.remove);
  const loadBudgets = useBudgetStore((state) => state.load);
  const [item, setItem] = useState<TransactionWithCategory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!id) return;
    transactionService
      .getById(id)
      .then(setItem)
      .catch((err) => setError(toUserMessage(err, 'This transaction could not be found.')));
  }, [id]);

  if (error) return <ErrorState message={error} onRetry={() => router.back()} />;
  if (!item) return <LoadingState />;

  return (
    <Screen scroll>
      <Card>
        <View style={styles.hero}>
          <CategoryIcon icon={item.categoryIcon} color={item.categoryColor} size={56} />
          <Text style={[styles.amount, { color: item.type === 'income' ? colors.income : colors.expense }]}>
            {formatMoney(item.amount, currency, { type: item.type })}
          </Text>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{item.title}</Text>
          <Text style={{ color: colors.textSecondary }}>
            {item.isTransfer ? 'Transfer' : item.type === 'income' ? 'Income' : 'Expense'}
          </Text>
        </View>
      </Card>
      <Card>
        <Row label="Account" value={item.accountName ?? 'No account assigned'} color={colors} />
        {item.isTransfer ? null : <Row label="Category" value={item.categoryName} color={colors} />}
        <Row label="Date" value={formatDisplayDate(item.date)} color={colors} />
        <Row label="Payment" value={paymentMethodLabel(item.paymentMethod)} color={colors} />
        <Row label="Recurring" value={item.isRecurring ? 'Yes' : 'No'} color={colors} />
        <Row label="Notes" value={item.notes || 'None'} color={colors} />
      </Card>
      <Button title="Edit" onPress={() => router.push({ pathname: '/transaction/edit', params: { id: item.id } })} />
      <Button title="Delete" variant="danger" onPress={() => setConfirm(true)} />
      <ConfirmDialog
        visible={confirm}
        title="Delete transaction?"
        message="This will permanently remove the transaction from your device."
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          try {
            await remove(item.id);
            await loadBudgets();
            router.back();
          } catch (err) {
            Alert.alert('Could not delete', toUserMessage(err, 'Please try again.'));
          }
        }}
      />
    </Screen>
  );
}

function Row({ label, value, color }: { label: string; value: string; color: { textSecondary: string; textPrimary: string } }) {
  return (
    <View style={styles.row}>
      <Text style={{ color: color.textSecondary }}>{label}</Text>
      <Text style={{ color: color.textPrimary, fontWeight: '600', flex: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 8 },
  amount: { fontSize: 36, fontWeight: '800' },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 10 },
});
