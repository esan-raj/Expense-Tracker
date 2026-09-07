import { useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { BudgetForm } from '@/components/forms/BudgetForm';
import { useBudgetStore } from '@/store/useBudgetStore';
import { toUserMessage } from '@/utils/errors';

export default function AddBudgetScreen() {
  const create = useBudgetStore((state) => state.create);
  const [submitting, setSubmitting] = useState(false);

  return (
    <Screen scroll>
      <BudgetForm
        submitting={submitting}
        onSubmit={async (values) => {
          setSubmitting(true);
          try {
            await create({
              categoryId: values.categoryId,
              amount: values.amountMinor,
              month: values.month,
              year: values.year,
            });
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
