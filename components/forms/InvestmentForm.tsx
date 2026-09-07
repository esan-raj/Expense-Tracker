import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { StyleSheet, View } from 'react-native';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { DatePicker } from '@/components/ui/DatePicker';
import { Button } from '@/components/ui/Button';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useAccountStore } from '@/store/useAccountStore';
import { investmentFormSchema, type InvestmentFormValues } from '@/utils/validation';
import { fromMinorUnits, parseAmountInput, toMinorUnits } from '@/utils/currency';
import { getCurrency } from '@/constants/currencies';
import { todayKey } from '@/utils/dates';
import { INVESTMENT_TYPES, investmentTypeLabel, type Investment } from '@/types';

interface InvestmentFormProps {
  initial?: Investment;
  submitting?: boolean;
  onSubmit: (values: InvestmentFormValues & { investedMinor: number; currentMinor: number }) => void;
}

export function InvestmentForm({ initial, submitting, onSubmit }: InvestmentFormProps) {
  const currencyCode = useSettingsStore((state) => state.settings.currency);
  const currency = getCurrency(currencyCode);
  const loadAccounts = useAccountStore((state) => state.load);
  const accounts = useAccountStore((state) => state.accounts);
  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);
  const activeAccounts = accounts.filter((item) => item.isActive);
  const form = useForm<InvestmentFormValues>({
    resolver: zodResolver(investmentFormSchema),
    defaultValues: {
      name: initial?.name ?? '',
      type: initial?.type ?? 'mutual_fund',
      investedAmount: initial ? fromMinorUnits(initial.investedAmount, currency.decimals) : 0,
      currentValue: initial ? fromMinorUnits(initial.currentValue, currency.decimals) : undefined,
      investmentDate: initial?.investmentDate ?? todayKey(),
      accountId: initial?.accountId ?? '',
      notes: initial?.notes ?? '',
    },
  });

  return (
    <View style={styles.form}>
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <Input label="Investment name" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={form.control}
        name="type"
        render={({ field, fieldState }) => (
          <Select
            label="Type"
            value={field.value}
            onChange={field.onChange}
            error={fieldState.error?.message}
            options={INVESTMENT_TYPES.map((type) => ({ value: type, label: investmentTypeLabel(type) }))}
          />
        )}
      />
      <Controller
        control={form.control}
        name="investedAmount"
        render={({ field, fieldState }) => (
          <CurrencyInput
            label="Amount invested"
            value={field.value ? String(field.value) : ''}
            onChangeText={(text) => field.onChange(parseAmountInput(text) ?? 0)}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="currentValue"
        render={({ field, fieldState }) => (
          <CurrencyInput
            label="Current value (optional)"
            value={field.value ? String(field.value) : ''}
            onChangeText={(text) => field.onChange(parseAmountInput(text) ?? 0)}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="investmentDate"
        render={({ field, fieldState }) => (
          <DatePicker label="Investment date" value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
        )}
      />
      {activeAccounts.length > 0 ? (
        <Controller
          control={form.control}
          name="accountId"
          render={({ field, fieldState }) => (
            <Select
              label="Linked account (optional)"
              value={field.value || undefined}
              placeholder="None"
              onChange={field.onChange}
              error={fieldState.error?.message}
              options={activeAccounts.map((item) => ({ value: item.id, label: item.name }))}
            />
          )}
        />
      ) : null}
      <Controller
        control={form.control}
        name="notes"
        render={({ field, fieldState }) => (
          <Input label="Notes" value={field.value ?? ''} onChangeText={field.onChange} error={fieldState.error?.message} />
        )}
      />
      <Button
        title={initial ? 'Save investment' : 'Add Investment'}
        loading={submitting}
        onPress={form.handleSubmit((values) => {
          const investedMinor = toMinorUnits(values.investedAmount, currency.decimals);
          const currentMinor =
            values.currentValue != null && values.currentValue > 0
              ? toMinorUnits(values.currentValue, currency.decimals)
              : investedMinor;
          onSubmit({ ...values, investedMinor, currentMinor });
        })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14 },
});
