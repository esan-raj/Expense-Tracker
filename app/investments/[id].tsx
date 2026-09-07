import { useEffect, useState } from 'react';
import { Alert, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { Amount } from '@/components/ui/Amount';
import { InvestmentForm } from '@/components/forms/InvestmentForm';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ScreenSkeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { useInvestmentStore } from '@/store/useInvestmentStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useTheme } from '@/hooks/useTheme';
import { formatMoney } from '@/utils/currency';
import { investmentTypeLabel } from '@/types';
import { toUserMessage } from '@/utils/errors';

export default function InvestmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const currency = useSettingsStore((state) => state.settings.currency);
  const investments = useInvestmentStore((state) => state.investments);
  const loading = useInvestmentStore((state) => state.loading);
  const load = useInvestmentStore((state) => state.load);
  const update = useInvestmentStore((state) => state.update);
  const remove = useInvestmentStore((state) => state.remove);
  const [submitting, setSubmitting] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const item = investments.find((entry) => entry.id === id);
  if (loading && investments.length === 0) return <ScreenSkeleton variant="detail" />;
  if (!item) return <ErrorState message="This investment could not be found." />;
  const gain = item.currentValue - item.investedAmount;
  const gainPct = item.investedAmount > 0 ? Math.round((gain / item.investedAmount) * 10000) / 100 : null;

  return (
    <Screen scroll>
      <Card>
        <Text style={{ color: colors.textSecondary }}>{investmentTypeLabel(item.type)}</Text>
        <Text style={{ color: colors.textPrimary, fontSize: 22, fontWeight: '800', marginTop: 4 }}>{item.name}</Text>
        <Amount minor={item.currentValue} currency={currency} size="lg" />
        <Text style={{ color: colors.textSecondary, marginTop: 8 }}>
          Invested {formatMoney(item.investedAmount, currency)}
          {gainPct == null ? '' : ` · ${gain >= 0 ? '+' : ''}${gainPct}%`}
        </Text>
      </Card>
      <InvestmentForm
        initial={item}
        submitting={submitting}
        onSubmit={async (values) => {
          setSubmitting(true);
          try {
            await update(item.id, {
              name: values.name,
              type: values.type,
              investedAmount: values.investedMinor,
              currentValue: values.currentMinor,
              investmentDate: values.investmentDate,
              accountId: values.accountId || null,
              notes: values.notes,
            });
            router.back();
          } catch (error) {
            Alert.alert('Could not save', toUserMessage(error, 'Please try again.'));
          } finally {
            setSubmitting(false);
          }
        }}
      />
      <Button title="Delete investment" variant="danger" onPress={() => setConfirm(true)} />
      <ConfirmDialog
        visible={confirm}
        title="Delete this investment?"
        message="This removes it from SpendWise. It will not create or delete a bank transaction."
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setConfirm(false);
          await remove(item.id);
          router.back();
        }}
      />
    </Screen>
  );
}
