import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { DatePicker } from '@/components/ui/DatePicker';
import { Button } from '@/components/ui/Button';
import { AccountForm } from '@/components/forms/AccountForm';
import { useTheme } from '@/hooks/useTheme';
import { useCategoryStore } from '@/store/useCategoryStore';
import { useAccountStore } from '@/store/useAccountStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { categoryService } from '@/services/categoryService';
import { FREQUENCIES, PAYMENT_METHODS } from '@/utils/constants';
import { transactionFormSchema, type TransactionFormValues } from '@/utils/validation';
import { fromMinorUnits, parseAmountInput, toMinorUnits } from '@/utils/currency';
import { getCurrency } from '@/constants/currencies';
import { todayKey } from '@/utils/dates';
import { accountTypeLabel, isCashHolding } from '@/utils/accountLogic';
import { normalizeOptionLabel } from '@/utils/optionLabel';
import { AppError, toUserMessage } from '@/utils/errors';
import type { AccountType, CategoryType, TransactionWithCategory } from '@/types';
import { useCriticalWork } from '@/hooks/useCriticalWork';

interface TransactionFormProps {
  initial?: TransactionWithCategory;
  defaults?: {
    accountId?: string;
    entryType?: 'expense' | 'income' | 'transfer';
    sourceAccountId?: string;
    destinationAccountId?: string;
  };
  submitting?: boolean;
  onSubmit: (values: TransactionFormValues & { amountMinor: number }) => void;
}

export function TransactionForm({ initial, defaults, submitting, onSubmit }: TransactionFormProps) {
  useCriticalWork('transaction-form');
  const { colors } = useTheme();
  const categories = useCategoryStore((state) => state.categories);
  const loadCategories = useCategoryStore((state) => state.load);
  const accounts = useAccountStore((state) => state.accounts);
  const lastUsedId = useAccountStore((state) => state.lastUsedId);
  const loadAccounts = useAccountStore((state) => state.load);
  const createAccount = useAccountStore((state) => state.create);
  const currency = useSettingsStore((state) => getCurrency(state.settings.currency));
  const [accountDraft, setAccountDraft] = useState<AccountType | null>(null);
  const [savingAccount, setSavingAccount] = useState(false);

  useEffect(() => {
    void loadAccounts();
    void loadCategories();
  }, [loadAccounts, loadCategories]);

  const activeAccounts = accounts.filter((item) => item.isActive);
  const defaultAccount = defaults?.accountId ?? initial?.accountId ?? lastUsedId ?? activeAccounts[0]?.id ?? '';

  const form = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionFormSchema),
    defaultValues: {
      entryType: defaults?.entryType ?? (initial?.isTransfer ? 'transfer' : (initial?.type ?? 'expense')),
      type: defaults?.entryType === 'transfer' ? 'expense' : (defaults?.entryType ?? initial?.type ?? 'expense'),
      amount: initial ? fromMinorUnits(initial.amount, currency.decimals) : 0,
      title: initial?.title ?? '',
      categoryId: initial?.categoryId ?? '',
      accountId: defaultAccount,
      sourceAccountId: defaults?.sourceAccountId ?? '',
      destinationAccountId: defaults?.destinationAccountId ?? '',
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
  const accountId = form.watch('accountId');
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
  const allAccountOptions = accounts
    .filter((item) => item.isActive || item.id === accountId)
    .map((item) => ({
      value: item.id,
      label: `${item.name}${item.isActive ? '' : ' (archived)'} · ${accountTypeLabel(item.type)}`,
    }));

  useEffect(() => {
    const selected = accounts.find((item) => item.id === accountId);
    if (selected && isCashHolding(selected.type) && form.getValues('paymentMethod') === 'upi' && !initial) {
      form.setValue('paymentMethod', 'cash');
    }
  }, [accountId, accounts, form, initial]);

  const createCategory = async (name: string) => {
    if (normalizeOptionLabel(name) === 'transfer') {
      throw new AppError('Transfer is reserved for account movements.');
    }
    const categoryType: CategoryType = type;
    const created = await categoryService.createOrFind({
      name,
      icon: categoryType === 'income' ? 'cash' : 'ellipse',
      color: categoryType === 'income' ? '#059669' : '#64748B',
      type: categoryType,
    });
    await loadCategories();
    return created.id;
  };

  const accountActions = [
    { label: 'Add account', onPress: () => setAccountDraft('bank') },
    { label: 'Add cash wallet', onPress: () => setAccountDraft('cash') },
  ];

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
            placeholder={entryType === 'transfer' ? 'Cash withdrawal or deposit' : 'Lunch at Cafe'}
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
              <SearchableSelect
                label="From"
                value={field.value ?? ''}
                options={accountOptions}
                onChange={field.onChange}
                error={fieldState.error?.message}
                actions={accountActions}
              />
            )}
          />
          <Controller
            control={form.control}
            name="destinationAccountId"
            render={({ field, fieldState }) => (
              <SearchableSelect
                label="To"
                value={field.value ?? ''}
                options={accountOptions}
                onChange={field.onChange}
                error={fieldState.error?.message}
                actions={accountActions}
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
              <SearchableSelect
                label="Category"
                value={field.value ?? ''}
                options={categoryOptions}
                onChange={field.onChange}
                error={fieldState.error?.message}
                allowCreate
                onCreate={createCategory}
              />
            )}
          />
          <Controller
            control={form.control}
            name="accountId"
            render={({ field, fieldState }) => (
              <SearchableSelect
                label="Account"
                value={field.value ?? ''}
                placeholder="No account (legacy)"
                options={allAccountOptions.filter((item) => item.value)}
                onChange={field.onChange}
                error={fieldState.error?.message}
                actions={accountActions}
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
      <Modal visible={accountDraft != null} transparent animationType="fade" onRequestClose={() => setAccountDraft(null)}>
        <Pressable style={[styles.overlay, { backgroundColor: colors.overlay }]} onPress={() => setAccountDraft(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.surfaceElevated }]} onPress={() => undefined}>
            <Text style={[styles.sheetTitle, { color: colors.textPrimary }]}>
              {accountDraft === 'cash' ? 'Add cash wallet' : 'Add account'}
            </Text>
            {accountDraft ? (
              <AccountForm
                defaultType={accountDraft}
                submitting={savingAccount}
                onSubmit={async (values) => {
                  setSavingAccount(true);
                  try {
                    const created = await createAccount({
                      type: values.type,
                      name: values.name,
                      institutionName: values.institutionName,
                      currency: currency.code,
                      openingBalance: values.openingMinor,
                      creditLimit: values.limitMinor,
                    });
                    if (form.getValues('entryType') === 'transfer') {
                      if (!form.getValues('sourceAccountId')) form.setValue('sourceAccountId', created.id);
                      else form.setValue('destinationAccountId', created.id);
                    } else {
                      form.setValue('accountId', created.id);
                    }
                    setAccountDraft(null);
                  } catch (error) {
                    Alert.alert('Could not save', toUserMessage(error, 'Please try again.'));
                  } finally {
                    setSavingAccount(false);
                  }
                }}
              />
            ) : null}
            <Button title="Cancel" variant="ghost" onPress={() => setAccountDraft(null)} />
          </Pressable>
        </Pressable>
      </Modal>
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
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' },
  sheetTitle: { fontSize: 20, fontWeight: '800', marginBottom: 12 },
});
