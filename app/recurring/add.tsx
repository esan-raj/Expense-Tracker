import { useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { RecurringForm } from '@/components/forms/RecurringForm';
import { recurringService } from '@/services/recurringService';
import { useTransactionStore } from '@/store/useTransactionStore';
import { toUserMessage } from '@/utils/errors';

export default function AddRecurringScreen() {
  const reload = useTransactionStore((state) => state.load);
  const [submitting, setSubmitting] = useState(false);

  return (
    <Screen scroll>
      <RecurringForm
        submitting={submitting}
        onSubmit={async (values) => {
          setSubmitting(true);
          try {
            await recurringService.create({
              title: values.title,
              amount: values.amountMinor,
              type: values.type,
              categoryId: values.categoryId,
              frequency: values.frequency,
              startDate: values.startDate,
              paymentMethod: values.paymentMethod,
              accountId: values.accountId || null,
            });
            await reload();
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
