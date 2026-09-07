import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { DatePicker } from '@/components/ui/DatePicker';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/hooks/useTheme';
import { useCategoryStore } from '@/store/useCategoryStore';
import { useAccountStore } from '@/store/useAccountStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { FREQUENCIES, PAYMENT_METHODS } from '@/utils/constants';
import { transactionFormSchema, type TransactionFormValues } from '@/utils/validation';
import { fromMinorUnits, parseAmountInput, toMinorUnits } from '@/utils/currency';
import { getCurrency } from '@/constants/currencies';
import { todayKey } from '@/utils/dates';
import { accountTypeLabel } from '@/utils/accountLogic';
import type { TransactionWithCategory } from '@/types';

interface TransactionFormProps {
  initial?: TransactionWithCategory;
  submitting?: boolean;
  onSubmit: (values: TransactionFormValues & { amountMinor: number }) => void;
}

export function TransactionForm({ initial, submitting, onSubmit }: TransactionFormProps) {
  const { colors } = useTheme();
  const categories = useCategoryStore((state) => state.categories);
  const accounts = useAccountStore((state) => state.accounts);
  const lastUsedId = useAccountStore((state) => state.lastUsedId);
  const loadAccounts = useAccountStore((state) => state.load);
  const currency = useSettingsStore((state) => getCurrency(state.settings.currency));

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const activeAccounts = accounts.filter((item) => item.isActive);
  const defaultAccount = initial?.accountId ?? lastUsedId ?? activeAccounts[0]?.id ?? '';

  const form = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionFormSchema),
    defaultValues: {
      entryType: initial?.isTransfer ? 'transfer' : (initial?.type ?? 'expense'),
      type: initial?.type ?? 'expense',
      amount: initial ? fromMinorUnits(initial.amount, currency.decimals) : 0,
      title: initial?.title ?? '',
      categoryId: initial?.categoryId ?? '',
      accountId: defaultAccount,
      sourceAccountId: '',
      destinationAccountId: '',
      date: initial?.date ?? todayKey(),
      paymentMethod: initial?.paymentMethod ?? 'upi',
      notes: initial?.notes ?? '',
      isRecurring: initial?.isRecurring ?? false,
      frequency: 'monthly',
      recurringStartDate: initial?.date ?? todayKey(),
    },
  });

  const entryType = form.watch('entryType');
  const type = form.watch('type');
  const isRecurring = form.watch('isRecurring');
  const [showMore, setShowMore] = useState(Boolean(initial?.notes || initial?.isRecurring));
  const categoryOptions = useMemo(
    () =>
      categories
        .filter((item) => (item.type === type || item.type === 'both') && item.name.toLowerCase() !== 'transfer')
        .map((item) => ({ value: item.id, label: item.name })),
    [categories, type]
  );
  const accountOptions = activeAccounts.map((item) => ({
    value: item.id,
    label: `${item.name} · ${accountTypeLabel(item.type)}`,
  }));
  const allAccountOptions = accounts.map((item) => ({
    value: item.id,
    label: `${item.name}${item.isActive ? '' : ' (archived)'}`,
  }));

  return (
    <View style={styles.form}>
      <Controller
        control={form.control}
        name="entryType"
        render={({ field }) => (
          <SegmentedControl
            value={field.value}
            onChange={(value) => {
              field.onChange(value);
              if (value !== 'transfer') form.setValue('type', value);
            }}
            options={[
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' },
              { value: 'transfer', label: 'Transfer' },
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
          <Input
            label="Title"
            value={field.value}
            onChangeText={field.onChange}
            placeholder={entryType === 'transfer' ? 'Card payment' : 'Lunch at Cafe'}
            error={fieldState.error?.message}
          />
        )}
      />
      {entryType === 'transfer' ? (
        <>
          <Controller
            control={form.control}
            name="sourceAccountId"
            render={({ field, fieldState }) => (
              <Select
                label="From"
                value={field.value ?? ''}
                options={accountOptions}
                onChange={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={form.control}
            name="destinationAccountId"
            render={({ field, fieldState }) => (
              <Select
                label="To"
                value={field.value ?? ''}
                options={accountOptions}
                onChange={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
        </>
      ) : (
        <>
          <Controller
            control={form.control}
            name="categoryId"
            render={({ field, fieldState }) => (
              <Select
                label="Category"
                value={field.value ?? ''}
                options={categoryOptions}
                onChange={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={form.control}
            name="accountId"
            render={({ field, fieldState }) => (
              <Select
                label="Account"
                value={field.value ?? ''}
                placeholder="No account (legacy)"
                options={allAccountOptions.filter((item) => item.value && (activeAccounts.some((acc) => acc.id === item.value) || item.value === field.value))}
                onChange={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
        </>
      )}
      <Controller
        control={form.control}
        name="date"
        render={({ field, fieldState }) => (
          <DatePicker label="Date" value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
        )}
      />
      <Pressable onPress={() => setShowMore((value) => !value)} accessibilityRole="button" accessibilityLabel="More options">
        <Text style={{ color: colors.primary, fontWeight: '700' }}>{showMore ? 'Hide extra details' : 'More options'}</Text>
      </Pressable>
      {showMore ? (
        <>
          {entryType !== 'transfer' ? (
            <Controller
              control={form.control}
              name="paymentMethod"
              render={({ field, fieldState }) => (
                <Select
                  label="Payment method"
                  value={field.value}
                  options={PAYMENT_METHODS}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                />
              )}
            />
          ) : null}
          <Controller
            control={form.control}
            name="notes"
            render={({ field }) => (
              <Input
                label="Notes"
                value={field.value}
                onChangeText={field.onChange}
                placeholder="Optional"
                multiline
              />
            )}
          />
          {!initial && entryType !== 'transfer' ? (
            <View style={[styles.toggle, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.flex}>
                <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>Make this recurring</Text>
                <Text style={{ color: colors.textSecondary, marginTop: 4 }}>Automatically create future transactions</Text>
              </View>
              <Controller
                control={form.control}
                name="isRecurring"
                render={({ field }) => (
                  <Switch value={field.value} onValueChange={field.onChange} accessibilityLabel="Make this recurring" />
                )}
              />
            </View>
          ) : null}
          {isRecurring && !initial && entryType !== 'transfer' ? (
            <>
              <Controller
                control={form.control}
                name="frequency"
                render={({ field, fieldState }) => (
                  <Select
                    label="Frequency"
                    value={field.value}
                    options={FREQUENCIES}
                    onChange={field.onChange}
                    error={fieldState.error?.message}
                  />
                )}
              />
              <Controller
                control={form.control}
                name="recurringStartDate"
                render={({ field, fieldState }) => (
                  <DatePicker
                    label="Start date"
                    value={field.value ?? todayKey()}
                    onChange={field.onChange}
                    error={fieldState.error?.message}
                  />
                )}
              />
            </>
          ) : null}
        </>
      ) : null}
      <Button
        title={initial ? 'Save changes' : entryType === 'transfer' ? 'Save Transfer' : 'Save Transaction'}
        loading={submitting}
        onPress={form.handleSubmit((values) =>
          onSubmit({
            ...values,
            type: values.entryType === 'transfer' ? 'expense' : values.entryType,
            amountMinor: toMinorUnits(values.amount, currency.decimals),
          })
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16, paddingBottom: 32 },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  flex: { flex: 1 },
});
