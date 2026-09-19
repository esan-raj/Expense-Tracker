import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { PageScroll } from '@/components/ui/PageScroll';
import { Input } from '@/components/ui/Input';
import { ChipRow } from '@/components/ui/Chip';
import { Select } from '@/components/ui/Select';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ScreenSkeleton } from '@/components/ui/Skeleton';
import { PageHeader } from '@/components/ui/PageHeader';
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
import { accountTypeLabel } from '@/utils/accountLogic';
import { DatePicker } from '@/components/ui/DatePicker';
import { PAYMENT_METHODS, SEARCH_DEBOUNCE_MS, SORT_OPTIONS } from '@/utils/constants';
import { getDateRange, rangeToKeys, todayKey, type DateRangePreset } from '@/utils/dates';
import { spacing } from '@/constants/theme';
import type { PaymentMethod, TransactionSort, TransactionWithCategory } from '@/types';

type KindFilter = 'all' | 'expense' | 'income' | 'transfer' | 'investment';

export default function TransactionsScreen() {
  const { colors } = useTheme();
  const { isDesktop } = useBreakpoint();
  const items = useTransactionStore((state) => state.items);
  const loading = useTransactionStore((state) => state.loading);
  const error = useTransactionStore((state) => state.error);
  const load = useTransactionStore((state) => state.load);
  const loadMore = useTransactionStore((state) => state.loadMore);
  const setQuery = useTransactionStore((state) => state.setQuery);
  const query = useTransactionStore((state) => state.query);
  const categories = useCategoryStore((state) => state.categories);
  const accounts = useAccountStore((state) => state.accounts);
  const [search, setSearch] = useState(query.filters?.search ?? '');
  const [datePreset, setDatePreset] = useState<'all' | DateRangePreset>('all');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [showFilters, setShowFilters] = useState(false);
  const currency = useSettingsStore((state) => getCurrency(state.settings.currency));
  const investmentCategoryIds = categories
    .filter((item) => /invest|mutual|sip/i.test(item.name))
    .map((item) => item.id);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      void setQuery({ filters: { search } });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search]);

  const applyKind = (next: KindFilter) => {
    setKind(next);
    if (next === 'transfer') {
      void setQuery({ filters: { type: 'all', isTransfer: true, categoryIds: undefined } });
      return;
    }
    if (next === 'investment') {
      void setQuery({ filters: { type: 'all', isTransfer: undefined, categoryIds: investmentCategoryIds } });
      return;
    }
    void setQuery({
      filters: {
        type: next,
        isTransfer: undefined,
        categoryIds: undefined,
      },
    });
  };

  const sections = useMemo(() => {
    const groups = new Map<string, typeof items>();
    for (const item of items) {
      const list = groups.get(item.date) ?? [];
      list.push(item);
      groups.set(item.date, list);
    }
    return [...groups.entries()].map(([date, data]) => ({ title: getGroupLabel(date), data }));
  }, [items]);

  const openTransaction = useCallback((item: TransactionWithCategory) => {
    router.push(`/transaction/${item.id}`);
  }, []);

  const openTransactionById = useCallback((id: string) => {
    router.push(`/transaction/${id}`);
  }, []);

  const handleEndReached = useCallback(() => {
    void loadMore();
  }, [loadMore]);

  const renderTransaction = useCallback(
    ({ item }: { item: TransactionWithCategory }) => <TransactionRow item={item} onPress={openTransaction} />,
    [openTransaction]
  );

  const header = (
    <View style={styles.header}>
      <PageHeader
        title="Transactions"
        action={
          <Pressable
            onPress={() => setShowFilters((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel="Toggle filters"
            style={[styles.filterBtn, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
          >
            <Ionicons name="filter" size={18} color={colors.textPrimary} />
          </Pressable>
        }
      />
      <Input value={search} onChangeText={setSearch} placeholder="Search" />
      <ChipRow
        value={kind}
        onChange={applyKind}
        options={[
          { value: 'all', label: 'All' },
          { value: 'expense', label: 'Expenses' },
          { value: 'income', label: 'Income' },
          { value: 'transfer', label: 'Transfers' },
          { value: 'investment', label: 'Investments' },
        ]}
      />
      {showFilters ? (
        <>
          <View style={styles.filters}>
            <View style={styles.flex}>
              <SearchableSelect
                label="Account"
                value={query.filters?.accountId ?? 'all'}
                options={[
                  { value: 'all', label: 'All accounts' },
                  ...accounts.map((item) => ({
                    value: item.id,
                    label: `${item.name} · ${accountTypeLabel(item.type)}`,
                  })),
                ]}
                onChange={(value) => void setQuery({ filters: { accountId: value === 'all' ? undefined : value } })}
              />
            </View>
            <View style={styles.flex}>
              <SearchableSelect
                label="Category"
                value={query.filters?.categoryId ?? 'all'}
                options={[{ value: 'all', label: 'All categories' }, ...categories.map((item) => ({ value: item.id, label: item.name }))]}
                onChange={(value) => void setQuery({ filters: { categoryId: value === 'all' ? undefined : value } })}
              />
            </View>
          </View>
          <Select
            label="Payment"
            value={query.filters?.paymentMethod ?? 'all'}
            options={[{ value: 'all', label: 'All methods' }, ...PAYMENT_METHODS]}
            onChange={(value) =>
              void setQuery({ filters: { paymentMethod: value === 'all' ? undefined : (value as PaymentMethod) } })
            }
          />
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
        </>
      ) : null}
    </View>
  );

  const empty =
    loading && items.length === 0 ? (
      <ScreenSkeleton variant="list" />
    ) : error && items.length === 0 ? (
      <ErrorState message={error} onRetry={() => void load()} />
    ) : !loading && items.length === 0 ? (
      <EmptyState
        title="No transactions yet"
        message="Your recent transactions will appear here."
        actionLabel="+ Add transaction"
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
          {items.length > 0 ? <TransactionTable items={items} onPress={openTransactionById} /> : null}
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
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          updateCellsBatchingPeriod={50}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          renderSectionHeader={({ section }) => (
            <Text style={[styles.section, { color: colors.textSecondary, backgroundColor: colors.background }]}>
              {section.title}
            </Text>
          )}
          renderItem={renderTransaction}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroller: { flex: 1, minHeight: 0 },
  header: { paddingTop: 8, gap: 12 },
  filters: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 32, flexGrow: 1 },
  section: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', paddingVertical: 10 },
  filterBtn: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
