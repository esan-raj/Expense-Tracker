import { useState } from 'react';
import { Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { CategoryForm } from '@/components/forms/CategoryForm';
import { ErrorState } from '@/components/ui/ErrorState';
import { useCategoryStore } from '@/store/useCategoryStore';
import { toUserMessage } from '@/utils/errors';

export default function EditCategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const categories = useCategoryStore((state) => state.categories);
  const category = categories.find((item) => item.id === id);
  const update = useCategoryStore((state) => state.update);
  const [submitting, setSubmitting] = useState(false);

  if (!category) return <ErrorState message="This category could not be found." />;

  return (
    <Screen scroll>
      <CategoryForm
        initial={category}
        submitting={submitting}
        onSubmit={async (values) => {
          setSubmitting(true);
          try {
            await update(category.id, values);
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
