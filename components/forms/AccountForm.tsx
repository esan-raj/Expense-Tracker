import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { StyleSheet, View } from 'react-native';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Button } from '@/components/ui/Button';
import { useSettingsStore } from '@/store/useSettingsStore';
import { accountFormSchema, type AccountFormValues } from '@/utils/validation';
import { fromMinorUnits, parseAmountInput, toMinorUnits } from '@/utils/currency';
import { getCurrency } from '@/constants/currencies';
import type { Account } from '@/types';

interface AccountFormProps {
  initial?: Account;
  submitting?: boolean;
  onSubmit: (values: AccountFormValues & { openingMinor: number; limitMinor: number | null }) => void;
}

export function AccountForm({ initial, submitting, onSubmit }: AccountFormProps) {
  const currency = useSettingsStore((state) => getCurrency(state.settings.currency));
  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: {
      type: initial?.type === 'credit_card' ? 'credit_card' : 'bank',
      name: initial?.name ?? '',
      institutionName: initial?.institutionName ?? '',
      openingBalance: initial ? fromMinorUnits(initial.openingBalance, currency.decimals) : 0,
      creditLimit: initial?.creditLimit != null ? fromMinorUnits(initial.creditLimit, currency.decimals) : undefined,
    },
  });
  const type = form.watch('type');

  return (
    <View style={styles.form}>
      <Controller
        control={form.control}
        name="type"
        render={({ field }) => (
          <SegmentedControl
            value={field.value === 'credit_card' ? 'credit_card' : 'bank'}
            onChange={field.onChange}
            options={[
              { value: 'bank', label: 'Bank Account' },
              { value: 'credit_card', label: 'Credit Card' },
            ]}
          />
        )}
      />
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <Input
            label="Account name"
            value={field.value}
            onChangeText={field.onChange}
            placeholder={type === 'credit_card' ? 'HDFC Credit Card' : 'HDFC Bank'}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="institutionName"
        render={({ field }) => (
          <Input label="Institution" value={field.value} onChangeText={field.onChange} placeholder="HDFC" />
        )}
      />
      <Controller
        control={form.control}
        name="openingBalance"
        render={({ field, fieldState }) => (
          <CurrencyInput
            label={type === 'credit_card' ? 'Current outstanding' : 'Opening balance'}
            value={field.value ? String(field.value) : ''}
            onChangeText={(text) => field.onChange(parseAmountInput(text) ?? 0)}
            error={fieldState.error?.message}
          />
        )}
      />
      {type === 'credit_card' ? (
        <Controller
          control={form.control}
          name="creditLimit"
          render={({ field, fieldState }) => (
            <CurrencyInput
              label="Credit limit"
              value={field.value ? String(field.value) : ''}
              onChangeText={(text) => field.onChange(parseAmountInput(text) ?? 0)}
              error={fieldState.error?.message}
            />
          )}
        />
      ) : null}
      <Button
        title={initial ? 'Save account' : 'Add Account'}
        loading={submitting}
        onPress={form.handleSubmit((values) =>
          onSubmit({
            ...values,
            openingMinor: toMinorUnits(values.openingBalance, currency.decimals),
            limitMinor:
              values.type === 'credit_card' && values.creditLimit != null
                ? toMinorUnits(values.creditLimit, currency.decimals)
                : null,
          })
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16, paddingBottom: 32 },
});
