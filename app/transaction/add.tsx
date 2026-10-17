import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { TransactionForm } from '@/components/forms/TransactionForm';
import { useTransactionStore } from '@/store/useTransactionStore';
import { useAccountStore } from '@/store/useAccountStore';
import { useBudgetStore } from '@/store/useBudgetStore';
import { hapticSuccess } from '@/utils/haptics';
import { toUserMessage } from '@/utils/errors';
import { Alert } from 'react-native';
import { useSyncStore } from '@/store/useSyncStore';

export default function AddTransactionScreen() {
  const create = useTransactionStore((state) => state.create);
  const transfer = useTransactionStore((state) => state.transfer);
  const remember = useAccountStore((state) => state.remember);
  const loadBudgets = useBudgetStore((state) => state.load);
  const [submitting, setSubmitting] = useState(false);
  const isOnline = useSyncStore((state) => state.isOnline);
  const params = useLocalSearchParams<{ accountId?: string; type?: string; destAccountId?: string }>();
  const entryType = params.type === 'income' || params.type === 'transfer' || params.type === 'expense' ? params.type : undefined;

  return (
    <Screen scroll>
      <TransactionForm
        submitting={submitting}
        defaults={{
          accountId: params.accountId,
          entryType,
          sourceAccountId: entryType === 'transfer' ? params.accountId : undefined,
          destinationAccountId: entryType === 'transfer' ? params.destAccountId : undefined,
        }}
        onSubmit={async (values) => {
          setSubmitting(true);
          try {
            if (values.entryType === 'transfer') {
              await transfer({
                sourceAccountId: values.sourceAccountId!,
                destinationAccountId: values.destinationAccountId!,
                amount: values.amountMinor,
                date: values.date,
                notes: values.notes,
                title: values.title,
              });
              remember(values.sourceAccountId!);
            } else {
              await create({
                type: values.entryType,
                amount: values.amountMinor,
                title: values.title,
                categoryId: values.categoryId ?? '',
                date: values.date,
                paymentMethod: values.paymentMethod,
                notes: values.notes,
                isRecurring: values.isRecurring,
                frequency: values.frequency,
                recurringStartDate: values.recurringStartDate,
                accountId: values.accountId || null,
              });
              if (values.accountId) remember(values.accountId);
            }
            await loadBudgets();
            await hapticSuccess();
            if (!isOnline) {
              Alert.alert('Saved offline', 'This transaction is on your device and will sync when you are back online.');
            }
            router.back();
          } catch (error) {
            Alert.alert('Could not save', toUserMessage(error, 'Please try again.'));
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </Screen>
  );
}
