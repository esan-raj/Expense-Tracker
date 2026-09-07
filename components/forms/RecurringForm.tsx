import { useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { StyleSheet, View } from 'react-native';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { DatePicker } from '@/components/ui/DatePicker';
import { Button } from '@/components/ui/Button';
import { useCategoryStore } from '@/store/useCategoryStore';
import { useAccountStore } from '@/store/useAccountStore';
import { accountTypeLabel } from '@/utils/accountLogic';
import { useSettingsStore } from '@/store/useSettingsStore';
import { FREQUENCIES, PAYMENT_METHODS } from '@/utils/constants';
import { recurringFormSchema, type RecurringFormValues } from '@/utils/validation';
import { fromMinorUnits, parseAmountInput, toMinorUnits } from '@/utils/currency';
import { getCurrency } from '@/constants/currencies';
import { todayKey } from '@/utils/dates';
import type { RecurringTransaction } from '@/types';

interface RecurringFormProps {
  initial?: RecurringTransaction;
  submitting?: boolean;
  onSubmit: (values: RecurringFormValues & { amountMinor: number }) => void;
}

export function RecurringForm({ initial, submitting, onSubmit }: RecurringFormProps) {
  const categories = useCategoryStore((state) => state.categories);
  const accounts = useAccountStore((state) => state.accounts);
  const currency = useSettingsStore((state) => getCurrency(state.settings.currency));
  const form = useForm<RecurringFormValues>({
    resolver: zodResolver(recurringFormSchema),
    defaultValues: {
      title: initial?.title ?? '',
      amount: initial ? fromMinorUnits(initial.amount, currency.decimals) : 0,
      type: initial?.type ?? 'expense',
      categoryId: initial?.categoryId ?? '',
      frequency: initial?.frequency ?? 'monthly',
      startDate: initial?.startDate ?? todayKey(),
      paymentMethod: initial?.paymentMethod ?? 'upi',
      accountId: initial?.accountId ?? '',
    },
  });
  const type = form.watch('type');
  const categoryOptions = useMemo(
    () =>
      categories
        .filter((item) => item.id && (item.type === type || item.type === 'both') && item.name.toLowerCase() !== 'transfer')
        .map((item) => ({ value: item.id, label: item.name })),
    [categories, type]
  );

  return (
    <View style={styles.form}>
      <Controller
        control={form.control}
        name="type"
        render={({ field }) => (
          <SegmentedControl
            value={field.value}
            onChange={field.onChange}
            options={[
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' },
            ]}
          />
        )}
      />
      <Controller
        control={form.control}
        name="amount"
        render={({ field, fieldState }) => (
          <CurrencyInput
            value={field.value ? String(field.value) : ''}
            onChangeText={(text) => field.onChange(parseAmountInput(text) ?? 0)}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="title"
        render={({ field, fieldState }) => (
          <Input label="Title" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={form.control}
        name="categoryId"
        render={({ field, fieldState }) => (
          <Select label="Category" value={field.value} options={categoryOptions} onChange={field.onChange} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={form.control}
        name="accountId"
        render={({ field }) => (
          <Select
            label="Account"
            value={field.value ?? ''}
            placeholder="No account"
            options={accounts
              .filter((item) => item.isActive && item.id)
              .map((item) => ({
                value: item.id,
                label: `${item.name} · ${accountTypeLabel(item.type)}`,
              }))}
            onChange={field.onChange}
          />
        )}
      />
      <Controller
        control={form.control}
        name="frequency"
        render={({ field, fieldState }) => (
          <Select label="Frequency" value={field.value} options={FREQUENCIES} onChange={field.onChange} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={form.control}
        name="startDate"
        render={({ field, fieldState }) => (
          <DatePicker label="Start date" value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={form.control}
        name="paymentMethod"
        render={({ field }) => (
          <Select label="Payment method" value={field.value} options={PAYMENT_METHODS} onChange={field.onChange} />
        )}
      />
      <Button
        title={initial ? 'Save changes' : 'Save recurring'}
        loading={submitting}
        onPress={form.handleSubmit((values) =>
          onSubmit({
            ...values,
            amountMinor: toMinorUnits(values.amount, currency.decimals),
          })
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16, paddingBottom: 32 },
});
