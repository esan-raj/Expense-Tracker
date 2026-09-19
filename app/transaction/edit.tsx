import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { TransactionForm } from '@/components/forms/TransactionForm';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { transactionService } from '@/services/transactionService';
import { useTransactionStore } from '@/store/useTransactionStore';
import { useBudgetStore } from '@/store/useBudgetStore';
import { hapticSuccess } from '@/utils/haptics';
import { toUserMessage } from '@/utils/errors';
import type { TransactionWithCategory } from '@/types';

export default function EditTransactionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const update = useTransactionStore((state) => state.update);
  const updateTransfer = useTransactionStore((state) => state.updateTransfer);
  const loadBudgets = useBudgetStore((state) => state.load);
  const [item, setItem] = useState<TransactionWithCategory | null>(null);
  const [pair, setPair] = useState<{ sourceAccountId: string; destinationAccountId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const current = await transactionService.getById(id);
        setItem(current);
        if (current.isTransfer) {
          const linked = await transactionService.getTransferPair(id);
          if (linked) {
            setPair({
              sourceAccountId: linked.source.accountId ?? '',
              destinationAccountId: linked.destination.accountId ?? '',
            });
          }
        }
      } catch (err) {
        setError(toUserMessage(err, 'This transaction could not be found.'));
      }
    })();
  }, [id]);

  if (error) return <ErrorState message={error} />;
  if (!item) return <LoadingState />;

  return (
    <Screen scroll>
      <TransactionForm
        initial={item}
        defaults={pair ?? undefined}
        submitting={submitting}
        onSubmit={async (values) => {
          setSubmitting(true);
          try {
            if (item.isTransfer || values.entryType === 'transfer') {
              await updateTransfer(item.id, {
                sourceAccountId: values.sourceAccountId!,
                destinationAccountId: values.destinationAccountId!,
                amount: values.amountMinor,
                date: values.date,
                notes: values.notes,
                title: values.title,
              });
            } else {
              await update(item.id, {
                type: values.type,
                amount: values.amountMinor,
                title: values.title,
                categoryId: values.categoryId ?? item.categoryId,
                date: values.date,
                paymentMethod: values.paymentMethod,
                notes: values.notes,
                isRecurring: item.isRecurring,
                recurringId: item.recurringId,
                accountId: values.accountId || item.accountId,
                isTransfer: item.isTransfer,
                transferGroupId: item.transferGroupId,
                transferRole: item.transferRole,
              });
            }
            await loadBudgets();
            await hapticSuccess();
            router.back();
          } catch (err) {
            Alert.alert('Could not save', toUserMessage(err, 'Please try again.'));
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </Screen>
  );
}
