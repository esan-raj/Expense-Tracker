import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { AccountForm } from '@/components/forms/AccountForm';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState } from '@/components/ui/ErrorState';
import { ScreenSkeleton } from '@/components/ui/Skeleton';
import { Amount } from '@/components/ui/Amount';
import { DonutChart } from '@/components/charts/DonutChart';
import { useAccountStore } from '@/store/useAccountStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { accountOverviewSlices, isLiabilityAccount } from '@/utils/accountLogic';
import { toUserMessage } from '@/utils/errors';
import { useTheme } from '@/hooks/useTheme';
import { transactionService } from '@/services/transactionService';
import { useTransactionStore } from '@/store/useTransactionStore';
import { TransactionRow } from '@/components/transactions/TransactionRow';
import { SectionHeader } from '@/components/ui/SectionHeader';
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
  const [showEdit, setShowEdit] = useState(false);
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
  if (!accounts.length) return <ScreenSkeleton variant="detail" />;
  if (!item) return <ErrorState message="This account could not be found." />;

  const liability = isLiabilityAccount(item.type);
  const slices = accountOverviewSlices(item, item.expenditure);

  return (
    <Screen scroll>
      <Card>
        {liability ? (
          <View style={styles.hero}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Outstanding</Text>
            <Amount minor={item.outstanding} currency={currency} size="hero" />
            {item.creditLimit != null ? (
              <>
                <DonutChart
                  size={140}
                  centerLabel="Used"
                  centerValue={slices.used}
                  slices={[
                    { label: 'Used', amount: slices.used, color: colors.expense },
                    { label: 'Available', amount: slices.remaining, color: colors.income },
                  ]}
                />
                <View style={styles.stats}>
                  <Stat label="Credit limit" value={item.creditLimit} currency={currency} />
                  <Stat label="Available" value={item.availableCredit ?? 0} currency={currency} />
                  {item.utilizationPercent != null ? (
                    <View style={styles.stat}>
                      <Text style={[styles.label, { color: colors.textSecondary }]}>Utilization</Text>
                      <Text style={[styles.statValue, { color: colors.textPrimary }]}>{item.utilizationPercent.toFixed(2)}%</Text>
                    </View>
                  ) : null}
                </View>
              </>
            ) : null}
          </View>
        ) : (
          <>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Current balance</Text>
            <Amount minor={item.currentBalance} currency={currency} size="hero" />
          </>
        )}
        {!item.isActive ? <Text style={{ color: colors.textSecondary, marginTop: 8 }}>Archived — hidden from new transactions.</Text> : null}
      </Card>
      {activity.length > 0 ? (
        <Card>
          <SectionHeader title="Recent activity" />
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
      <Button title={showEdit ? 'Hide account settings' : 'Edit account'} variant="secondary" onPress={() => setShowEdit((value) => !value)} />
      {showEdit ? (
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
      ) : null}
      <Button
        title={item.isActive ? 'Archive account' : 'Reactivate account'}
        variant="ghost"
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

function Stat({ label, value, currency }: { label: string; value: number; currency: AccountWithBalances['currency'] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.stat}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <Amount minor={value} currency={currency} size="sm" />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 8 },
  label: { fontSize: 13, fontWeight: '600' },
  stats: { width: '100%', gap: 10, marginTop: 8 },
  stat: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
