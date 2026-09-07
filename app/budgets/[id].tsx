import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { BudgetCard } from '@/components/cards/BudgetCard';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState } from '@/components/ui/ErrorState';
import { useBudgetStore } from '@/store/useBudgetStore';
import { toUserMessage } from '@/utils/errors';

export default function BudgetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useBudgetStore((state) => state.items.find((budget) => budget.id === id));
  const remove = useBudgetStore((state) => state.remove);
  const [confirm, setConfirm] = useState(false);

  if (!item) return <ErrorState message="This budget could not be found." />;

  return (
    <Screen scroll>
      <BudgetCard item={item} onPress={() => undefined} />
      <Text />
      <Button title="Edit" onPress={() => router.push({ pathname: '/budgets/edit', params: { id: item.id } })} />
      <Button title="Delete" variant="danger" onPress={() => setConfirm(true)} />
      <ConfirmDialog
        visible={confirm}
        title="Delete budget?"
        message="This budget will be removed. Existing transactions stay as they are."
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          try {
            await remove(item.id);
            router.back();
          } catch (error) {
            Alert.alert('Could not delete', toUserMessage(error, 'Please try again.'));
          }
        }}
      />
    </Screen>
  );
}
