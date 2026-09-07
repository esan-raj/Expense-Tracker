import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { PageScroll } from '@/components/ui/PageScroll';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { CategoryIcon } from '@/components/categories/CategoryIcon';
import { recurringService } from '@/services/recurringService';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/store/useSettingsStore';
import { formatMoney } from '@/utils/currency';
import { formatDisplayDate } from '@/utils/dates';
import { frequencyLabel } from '@/utils/constants';
import type { RecurringTransactionWithCategory } from '@/types';

export default function RecurringListScreen() {
  const { colors } = useTheme();
  const currency = useSettingsStore((state) => state.settings.currency);
  const [items, setItems] = useState<RecurringTransactionWithCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setItems(await recurringService.list());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState />;

  return (
    <Screen padded={false}>
      <PageScroll style={styles.scroller} contentContainerStyle={styles.content}>
        <Button title="Add recurring" onPress={() => router.push('/recurring/add')} />
        {items.length === 0 ? (
          <EmptyState
            icon="repeat-outline"
            title="No recurring transactions"
            message="Add rent, subscriptions, or salary so SpendWise can create them automatically."
            actionLabel="Add recurring"
            onAction={() => router.push('/recurring/add')}
          />
        ) : (
          items.map((item) => (
            <Pressable key={item.id} onPress={() => router.push(`/recurring/${item.id}`)}>
              <Card>
                <View style={styles.row}>
                  <CategoryIcon icon={item.categoryIcon} color={item.categoryColor} />
                  <View style={styles.body}>
                    <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>{item.title}</Text>
                    <Text style={{ color: colors.textSecondary }}>
                      {frequencyLabel(item.frequency)} · Next: {formatDisplayDate(item.nextDate)}
                    </Text>
                    <Text style={{ color: item.isActive ? colors.success : colors.textTertiary }}>
                      {item.isActive ? 'Active' : 'Paused'}
                    </Text>
                  </View>
                  <Text style={{ color: colors.textPrimary, fontWeight: '800' }}>{formatMoney(item.amount, currency)}</Text>
                </View>
              </Card>
            </Pressable>
          ))
        )}
      </PageScroll>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroller: { flex: 1, minHeight: 0 },
  content: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  body: { flex: 1 },
});
