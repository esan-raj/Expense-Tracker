import { useState } from 'react';
import { Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { BudgetForm } from '@/components/forms/BudgetForm';
import { ErrorState } from '@/components/ui/ErrorState';
import { useBudgetStore } from '@/store/useBudgetStore';
import { toUserMessage } from '@/utils/errors';

export default function EditBudgetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useBudgetStore((state) => state.items.find((budget) => budget.id === id));
  const update = useBudgetStore((state) => state.update);
  const [submitting, setSubmitting] = useState(false);

  if (!item) return <ErrorState message="This budget could not be found." />;

  return (
    <Screen scroll>
      <BudgetForm
        initial={item}
        submitting={submitting}
        onSubmit={async (values) => {
          setSubmitting(true);
          try {
            await update(item.id, {
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
