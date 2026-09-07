import { useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { InvestmentForm } from '@/components/forms/InvestmentForm';
import { useInvestmentStore } from '@/store/useInvestmentStore';
import { toUserMessage } from '@/utils/errors';

export default function AddInvestmentScreen() {
  const create = useInvestmentStore((state) => state.create);
  const [submitting, setSubmitting] = useState(false);

  return (
    <Screen scroll>
      <InvestmentForm
        submitting={submitting}
        onSubmit={async (values) => {
          setSubmitting(true);
          try {
            await create({
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
    </Screen>
  );
}
