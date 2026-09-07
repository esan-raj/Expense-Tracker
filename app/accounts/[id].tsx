import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { AccountForm } from '@/components/forms/AccountForm';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useAccountStore } from '@/store/useAccountStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { formatMoney } from '@/utils/currency';
import { isLiabilityAccount } from '@/utils/accountLogic';
import { toUserMessage } from '@/utils/errors';
import { useTheme } from '@/hooks/useTheme';
import { transactionService } from '@/services/transactionService';
import { useTransactionStore } from '@/store/useTransactionStore';
import { TransactionRow } from '@/components/transactions/TransactionRow';
import type { AccountWithBalances, TransactionWithCategory } from '@/types';

export default function AccountDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const currency = useSettingsStore((state) => state.settings.currency);
  const load = useAccountStore((state) => state.load);
  const update = useAccountStore((state) => state.update);
  const archive = useAccountStore((state) => state.archive);
  const reactivate = useAccountStore((state) => state.reactivate);
  const remove = useAccountStore((state) => state.remove);
  const accounts = useAccountStore((state) => state.accounts);
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activity, setActivity] = useState<TransactionWithCategory[]>([]);
  const setQuery = useTransactionStore((state) => state.setQuery);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!id) return;
    void transactionService
      .query({ filters: { accountId: id }, sort: 'newest', limit: 8, offset: 0 })
      .then(setActivity);
  }, [id]);

  const item = accounts.find((entry) => entry.id === id) as AccountWithBalances | undefined;
  if (!accounts.length) return <LoadingState />;
  if (!item) return <ErrorState message="This account could not be found." />;

  return (
    <Screen scroll>
      <Card>
        {isLiabilityAccount(item.type) ? (
          <>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Outstanding</Text>
            <Text style={[styles.value, { color: colors.textPrimary }]}>{formatMoney(item.outstanding, currency)}</Text>
            {item.creditLimit != null ? (
              <>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Credit limit</Text>
                <Text style={[styles.value, { color: colors.textPrimary }]}>{formatMoney(item.creditLimit, currency)}</Text>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Available credit</Text>
                <Text style={[styles.value, { color: colors.textPrimary }]}>
                  {formatMoney(item.availableCredit ?? 0, currency)}
                </Text>
              </>
            ) : null}
          </>
        ) : (
          <>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Balance</Text>
            <Text style={[styles.value, { color: colors.textPrimary }]}>{formatMoney(item.currentBalance, currency)}</Text>
          </>
        )}
        {!item.isActive ? <Text style={{ color: colors.textSecondary }}>Archived — hidden from new transactions.</Text> : null}
      </Card>
      {activity.length > 0 ? (
        <Card>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Recent activity</Text>
          {activity.map((entry) => (
            <TransactionRow key={entry.id} item={entry} onPress={() => router.push(`/transaction/${entry.id}`)} />
          ))}
          <Button
            title="View all activity"
            variant="secondary"
            onPress={() => {
              void setQuery({ filters: { accountId: item.id } });
              router.push('/(tabs)/transactions');
            }}
          />
        </Card>
      ) : (
        <Card>
          <Text style={{ color: colors.textSecondary }}>
            No transactions on this account yet. Older transactions stay unassigned until you edit them.
          </Text>
        </Card>
      )}
      <AccountForm
        initial={item}
        submitting={submitting}
        onSubmit={async (values) => {
          setSubmitting(true);
          try {
            await update(item.id, {
              type: values.type,
              name: values.name,
              institutionName: values.institutionName,
              currency: item.currency,
              openingBalance: values.openingMinor,
              creditLimit: values.limitMinor,
              isActive: item.isActive,
            });
            router.back();
          } catch (error) {
            Alert.alert('Could not save', toUserMessage(error, 'Please try again.'));
          } finally {
            setSubmitting(false);
          }
        }}
      />
      <Button
        title={item.isActive ? 'Archive account' : 'Reactivate account'}
        variant="secondary"
        onPress={async () => {
          if (item.isActive) await archive(item.id);
          else await reactivate(item.id);
          router.back();
        }}
      />
      <Button title="Delete" variant="danger" onPress={() => setConfirm(true)} />
      <ConfirmDialog
        visible={confirm}
        title="Remove this account?"
        message="If it has transactions, it will be archived instead of deleted so history stays intact."
        confirmLabel="Continue"
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          await remove(item.id);
          setConfirm(false);
          router.back();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  value: { fontSize: 22, fontWeight: '800' },
});
