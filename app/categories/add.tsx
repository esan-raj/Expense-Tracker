import { useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { CategoryForm } from '@/components/forms/CategoryForm';
import { useCategoryStore } from '@/store/useCategoryStore';
import { toUserMessage } from '@/utils/errors';

export default function AddCategoryScreen() {
  const create = useCategoryStore((state) => state.create);
  const [submitting, setSubmitting] = useState(false);

  return (
    <Screen scroll>
      <CategoryForm
        submitting={submitting}
        onSubmit={async (values) => {
          setSubmitting(true);
          try {
            await create(values);
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
