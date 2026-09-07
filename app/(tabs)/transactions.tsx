import { useEffect, useMemo, useState } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { PageScroll } from '@/components/ui/PageScroll';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TransactionRow } from '@/components/transactions/TransactionRow';
import { TransactionTable } from '@/components/transactions/TransactionTable';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useTheme } from '@/hooks/useTheme';
import { useTransactionStore } from '@/store/useTransactionStore';
import { useCategoryStore } from '@/store/useCategoryStore';
import { useAccountStore } from '@/store/useAccountStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { getCurrency } from '@/constants/currencies';
import { parseAmountInput, toMinorUnits } from '@/utils/currency';
import { getGroupLabel } from '@/utils/dates';
import { DatePicker } from '@/components/ui/DatePicker';
import { PAYMENT_METHODS, SEARCH_DEBOUNCE_MS, SORT_OPTIONS } from '@/utils/constants';
import { getDateRange, rangeToKeys, todayKey, type DateRangePreset } from '@/utils/dates';
import type { PaymentMethod, TransactionSort, TransactionType } from '@/types';

export default function TransactionsScreen() {
  const { colors } = useTheme();
  const { isDesktop } = useBreakpoint();
  const { items, loading, error, load, loadMore, setQuery, query } = useTransactionStore();
  const categories = useCategoryStore((state) => state.categories);
  const accounts = useAccountStore((state) => state.accounts);
  const [search, setSearch] = useState(query.filters?.search ?? '');
  const [datePreset, setDatePreset] = useState<'all' | DateRangePreset>('all');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const currency = useSettingsStore((state) => getCurrency(state.settings.currency));

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      void setQuery({ filters: { search } });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search]);

  const sections = useMemo(() => {
    const groups = new Map<string, typeof items>();
    for (const item of items) {
      const list = groups.get(item.date) ?? [];
      list.push(item);
      groups.set(item.date, list);
    }
    return [...groups.entries()].map(([date, data]) => ({ title: getGroupLabel(date), data }));
  }, [items]);

  const header = (
    <View style={styles.header}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Transactions</Text>
      <Input value={search} onChangeText={setSearch} placeholder="Search transactions..." />
      <SegmentedControl
        value={(query.filters?.type ?? 'all') as 'all' | TransactionType}
        onChange={(type) => void setQuery({ filters: { type } })}
        options={[
          { value: 'all', label: 'All' },
          { value: 'expense', label: 'Expenses' },
          { value: 'income', label: 'Income' },
        ]}
      />
      <View style={styles.filters}>
        <View style={styles.flex}>
          <Select
            label="Account"
            value={query.filters?.accountId ?? 'all'}
            options={[{ value: 'all', label: 'All accounts' }, ...accounts.map((item) => ({ value: item.id, label: item.name }))]}
            onChange={(value) => void setQuery({ filters: { accountId: value === 'all' ? undefined : value } })}
          />
          <Select
            label="Category"
            value={query.filters?.categoryId ?? 'all'}
            options={[{ value: 'all', label: 'All categories' }, ...categories.map((item) => ({ value: item.id, label: item.name }))]}
            onChange={(value) => void setQuery({ filters: { categoryId: value === 'all' ? undefined : value } })}
          />
        </View>
        <View style={styles.flex}>
          <Select
            label="Payment"
            value={query.filters?.paymentMethod ?? 'all'}
            options={[{ value: 'all', label: 'All methods' }, ...PAYMENT_METHODS]}
            onChange={(value) =>
              void setQuery({ filters: { paymentMethod: value === 'all' ? undefined : (value as PaymentMethod) } })
            }
          />
        </View>
      </View>
      <Select
        label="Date range"
        value={datePreset}
        options={[
          { value: 'all', label: 'All time' },
          { value: 'this_month', label: 'This month' },
          { value: 'last_month', label: 'Last month' },
          { value: 'custom', label: 'Custom' },
        ]}
        onChange={(value) => {
          const next = value as 'all' | DateRangePreset;
          setDatePreset(next);
          if (next === 'all') {
            void setQuery({ filters: { startDate: undefined, endDate: undefined } });
            return;
          }
          if (next !== 'custom') {
            const keys = rangeToKeys(getDateRange(next));
            void setQuery({ filters: keys });
          }
        }}
      />
      {datePreset === 'custom' ? (
        <View style={styles.filters}>
          <View style={styles.flex}>
            <DatePicker
              label="From"
              value={query.filters?.startDate ?? todayKey()}
              onChange={(value) => void setQuery({ filters: { startDate: value } })}
            />
          </View>
          <View style={styles.flex}>
            <DatePicker
              label="To"
              value={query.filters?.endDate ?? todayKey()}
              onChange={(value) => void setQuery({ filters: { endDate: value } })}
            />
          </View>
        </View>
      ) : null}
      <View style={styles.filters}>
        <View style={styles.flex}>
          <Input
            label="Min amount"
            value={minAmount}
            keyboardType="decimal-pad"
            placeholder="0"
            onChangeText={(value) => {
              setMinAmount(value);
              const parsed = parseAmountInput(value);
              void setQuery({
                filters: { minAmount: parsed ? toMinorUnits(parsed, currency.decimals) : undefined },
              });
            }}
          />
        </View>
        <View style={styles.flex}>
          <Input
            label="Max amount"
            value={maxAmount}
            keyboardType="decimal-pad"
            placeholder="Any"
            onChangeText={(value) => {
              setMaxAmount(value);
              const parsed = parseAmountInput(value);
              void setQuery({
                filters: { maxAmount: parsed ? toMinorUnits(parsed, currency.decimals) : undefined },
              });
            }}
          />
        </View>
      </View>
      <Select
        label="Sort"
        value={query.sort ?? 'newest'}
        options={SORT_OPTIONS}
        onChange={(value) => void setQuery({ sort: value as TransactionSort })}
      />
    </View>
  );

  const empty =
    loading && items.length === 0 ? (
      <LoadingState />
    ) : error && items.length === 0 ? (
      <ErrorState message={error} onRetry={() => void load()} />
    ) : !loading && items.length === 0 ? (
      <EmptyState
        title="No transactions yet"
        message="Start tracking your spending by adding your first transaction."
        actionLabel="+ Add Transaction"
        onAction={() => router.push('/transaction/add')}
      />
    ) : null;

  return (
    <Screen padded={false}>
      {isDesktop ? (
        <PageScroll
          style={styles.scroller}
          contentContainerStyle={styles.list}
          onScroll={(event) => {
            const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
            if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 80) {
              void loadMore();
            }
          }}
          scrollEventThrottle={16}
        >
          {header}
          {empty}
          {items.length > 0 ? <TransactionTable items={items} onPress={(id) => router.push(`/transaction/${id}`)} /> : null}
        </PageScroll>
      ) : (
        <SectionList
          style={styles.scroller}
          sections={sections}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
          renderSectionHeader={({ section }) => (
            <Text style={[styles.section, { color: colors.textSecondary, backgroundColor: colors.background }]}>
              {section.title}
            </Text>
          )}
          renderItem={({ item }) => (
            <TransactionRow item={item} onPress={() => router.push(`/transaction/${item.id}`)} />
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroller: { flex: 1, minHeight: 0 },
  header: { paddingTop: 8, gap: 12 },
  title: { fontSize: 28, fontWeight: '800' },
  filters: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 32, flexGrow: 1 },
  section: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', paddingVertical: 10 },
});
