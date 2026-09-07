import { useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { AccountForm } from '@/components/forms/AccountForm';
import { useAccountStore } from '@/store/useAccountStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { toUserMessage } from '@/utils/errors';

export default function AddAccountScreen() {
  const create = useAccountStore((state) => state.create);
  const currency = useSettingsStore((state) => state.settings.currency);
  const [submitting, setSubmitting] = useState(false);

  return (
    <Screen scroll>
      <AccountForm
        submitting={submitting}
        onSubmit={async (values) => {
          setSubmitting(true);
          try {
            await create({
              type: values.type,
              name: values.name,
              institutionName: values.institutionName,
              currency,
              openingBalance: values.openingMinor,
              creditLimit: values.limitMinor,
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
