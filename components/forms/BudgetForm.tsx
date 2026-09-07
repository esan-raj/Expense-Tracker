import { useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { StyleSheet, View } from 'react-native';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { useCategoryStore } from '@/store/useCategoryStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { budgetFormSchema, type BudgetFormValues } from '@/utils/validation';
import { fromMinorUnits, parseAmountInput, toMinorUnits } from '@/utils/currency';
import { getCurrency } from '@/constants/currencies';
import { currentMonthYear } from '@/utils/dates';
import type { Budget } from '@/types';

interface BudgetFormProps {
  initial?: Budget;
  submitting?: boolean;
  onSubmit: (values: BudgetFormValues & { amountMinor: number }) => void;
}

export function BudgetForm({ initial, submitting, onSubmit }: BudgetFormProps) {
  const categories = useCategoryStore((state) => state.categories);
  const currency = useSettingsStore((state) => getCurrency(state.settings.currency));
  const period = currentMonthYear();
  const form = useForm<BudgetFormValues>({
    resolver: zodResolver(budgetFormSchema),
    defaultValues: {
      categoryId: initial?.categoryId ?? null,
      amount: initial ? fromMinorUnits(initial.amount, currency.decimals) : 0,
      month: initial?.month ?? period.month,
      year: initial?.year ?? period.year,
    },
  });

  const categoryOptions = useMemo(
    () => [
      { value: 'overall', label: 'Overall monthly budget' },
      ...categories
        .filter((item) => item.type === 'expense' || item.type === 'both')
        .map((item) => ({ value: item.id, label: item.name })),
    ],
    [categories]
  );

  const months = Array.from({ length: 12 }, (_, index) => ({
    value: String(index + 1),
    label: new Date(2026, index, 1).toLocaleString('en', { month: 'long' }),
  }));
  const years = [period.year - 1, period.year, period.year + 1].map((year) => ({
    value: String(year),
    label: String(year),
  }));

  return (
    <View style={styles.form}>
      <Controller
        control={form.control}
        name="categoryId"
        render={({ field }) => (
          <Select
            label="Category"
            value={field.value ?? 'overall'}
            options={categoryOptions}
            onChange={(value) => field.onChange(value === 'overall' ? null : value)}
          />
        )}
      />
      <Controller
        control={form.control}
        name="amount"
        render={({ field, fieldState }) => (
          <CurrencyInput
            label="Monthly amount"
            value={field.value ? String(field.value) : ''}
            onChangeText={(text) => field.onChange(parseAmountInput(text) ?? 0)}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="month"
        render={({ field }) => (
          <Select
            label="Month"
            value={String(field.value)}
            options={months}
            onChange={(value) => field.onChange(Number(value))}
          />
        )}
      />
      <Controller
        control={form.control}
        name="year"
        render={({ field }) => (
          <Select
            label="Year"
            value={String(field.value)}
            options={years}
            onChange={(value) => field.onChange(Number(value))}
          />
        )}
      />
      <Button
        title={initial ? 'Save budget' : 'Create budget'}
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
