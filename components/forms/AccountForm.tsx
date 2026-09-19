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
import type { Account, AccountType } from '@/types';
import { useCriticalWork } from '@/hooks/useCriticalWork';

interface AccountFormProps {
  initial?: Account;
  defaultType?: AccountType;
  submitting?: boolean;
  onSubmit: (values: AccountFormValues & { openingMinor: number; limitMinor: number | null }) => void;
}

function resolveType(initial?: Account, defaultType?: AccountType): AccountType {
  if (initial?.type) return initial.type;
  if (defaultType) return defaultType;
  return 'bank';
}

export function AccountForm({ initial, defaultType, submitting, onSubmit }: AccountFormProps) {
  useCriticalWork('account-form');
  const currency = useSettingsStore((state) => getCurrency(state.settings.currency));
  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: {
      type: resolveType(initial, defaultType),
      name: initial?.name ?? '',
      institutionName: initial?.institutionName ?? '',
      openingBalance: initial ? fromMinorUnits(initial.openingBalance, currency.decimals) : 0,
      creditLimit: initial?.creditLimit != null ? fromMinorUnits(initial.creditLimit, currency.decimals) : undefined,
    },
  });
  const type = form.watch('type');
  const typeOptions: { value: AccountType; label: string }[] = [
    { value: 'bank', label: 'Bank' },
    { value: 'cash', label: 'Cash' },
    { value: 'credit_card', label: 'Card' },
  ];
  if (type === 'wallet' && !typeOptions.some((item) => item.value === 'wallet')) {
    typeOptions.splice(2, 0, { value: 'wallet', label: 'Wallet' });
  }
  if ((type === 'investment' || type === 'loan' || type === 'other') && !typeOptions.some((item) => item.value === type)) {
    typeOptions.push({ value: type, label: type === 'loan' ? 'Loan' : type === 'investment' ? 'Investment' : 'Other' });
  }

  return (
    <View style={styles.form}>
      <Controller
        control={form.control}
        name="type"
        render={({ field }) => (
          <SegmentedControl value={field.value} onChange={field.onChange} options={typeOptions} />
        )}
      />
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <Input
            label={type === 'cash' || type === 'wallet' ? 'Wallet name' : 'Account name'}
            value={field.value}
            onChangeText={field.onChange}
            placeholder={
              type === 'credit_card' ? 'HDFC Credit Card' : type === 'cash' || type === 'wallet' ? 'Cash in hand' : 'HDFC Bank'
            }
            error={fieldState.error?.message}
          />
        )}
      />
      {type === 'cash' || type === 'wallet' ? null : (
        <Controller
          control={form.control}
          name="institutionName"
          render={({ field }) => (
            <Input label="Institution" value={field.value} onChangeText={field.onChange} placeholder="HDFC" />
          )}
        />
      )}
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
        title={initial ? 'Save account' : type === 'cash' || type === 'wallet' ? 'Add cash wallet' : 'Add Account'}
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
