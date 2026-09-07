import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { RecurringForm } from '@/components/forms/RecurringForm';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { recurringService } from '@/services/recurringService';
import { useTransactionStore } from '@/store/useTransactionStore';
import { toUserMessage } from '@/utils/errors';
import type { RecurringTransactionWithCategory } from '@/types';

export default function RecurringDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const reload = useTransactionStore((state) => state.load);
  const [item, setItem] = useState<RecurringTransactionWithCategory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!id) return;
    recurringService
      .list()
      .then((items) => {
        const found = items.find((entry) => entry.id === id);
        if (!found) setError('This recurring transaction could not be found.');
        else setItem(found);
      })
      .catch((err) => setError(toUserMessage(err, 'Could not load this item.')));
  }, [id]);

  if (error) return <ErrorState message={error} />;
  if (!item) return <LoadingState />;

  return (
    <Screen scroll>
      <RecurringForm
        initial={item}
        submitting={submitting}
        onSubmit={async (values) => {
          setSubmitting(true);
          try {
            await recurringService.update(item.id, {
              title: values.title,
              amount: values.amountMinor,
              type: values.type,
              categoryId: values.categoryId,
              frequency: values.frequency,
              startDate: values.startDate,
              paymentMethod: values.paymentMethod,
              accountId: values.accountId || null,
              isActive: item.isActive,
            });
            await reload();
            router.back();
          } catch (err) {
            Alert.alert('Could not save', toUserMessage(err, 'Please try again.'));
          } finally {
            setSubmitting(false);
          }
        }}
      />
      <Button
        title={item.isActive ? 'Pause' : 'Resume'}
        variant="secondary"
        onPress={async () => {
          await recurringService.setActive(item.id, !item.isActive);
          await reload();
          router.back();
        }}
      />
      <Button title="Delete" variant="danger" onPress={() => setConfirm(true)} />
      <ConfirmDialog
        visible={confirm}
        title="Delete recurring transaction?"
        message="Future automatic transactions will stop. Existing transactions stay in your history."
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          await recurringService.delete(item.id);
          router.back();
        }}
      />
    </Screen>
  );
}
