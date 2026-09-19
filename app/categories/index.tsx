import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { PageScroll } from '@/components/ui/PageScroll';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Select } from '@/components/ui/Select';
import { CategoryIcon } from '@/components/categories/CategoryIcon';
import { PageHeader } from '@/components/ui/PageHeader';
import { IconButton } from '@/components/ui/IconButton';
import { ChipRow } from '@/components/ui/Chip';
import { Amount } from '@/components/ui/Amount';
import { useTheme } from '@/hooks/useTheme';
import { useCategoryStore } from '@/store/useCategoryStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { categoryService } from '@/services/categoryService';
import { reportService } from '@/services/reportService';
import { getDateRange } from '@/utils/dates';
import { toUserMessage } from '@/utils/errors';
import { spacing } from '@/constants/theme';

type CategoryTab = 'all' | 'expense' | 'income';

export default function CategoriesScreen() {
  const { colors } = useTheme();
  const categories = useCategoryStore((state) => state.categories);
  const remove = useCategoryStore((state) => state.remove);
  const currency = useSettingsStore((state) => state.settings.currency);
  const [spend, setSpend] = useState<Record<string, { amount: number; percent: number }>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [reassignTo, setReassignTo] = useState<string>('');
  const [needsReassign, setNeedsReassign] = useState(false);
  const [tab, setTab] = useState<CategoryTab>('all');
  const visible = useMemo(
    () => categories.filter((item) => tab === 'all' || item.type === tab || item.type === 'both'),
    [categories, tab]
  );

  useEffect(() => {
    void reportService.analytics(getDateRange('this_month')).then((data) => {
      setSpend(Object.fromEntries(data.categories.map((item) => [item.categoryId, { amount: item.amount, percent: item.percent }])));
    });
  }, []);

  const requestDelete = async (id: string) => {
    const usage = await categoryService.usage(id);
    setPendingId(id);
    setNeedsReassign(usage.total > 0);
    setReassignTo(categories.find((item) => item.id !== id)?.id ?? '');
  };

  return (
    <Screen padded={false}>
      <PageScroll style={styles.scroller} contentContainerStyle={styles.content}>
        <PageHeader
          title="Categories"
          action={<IconButton name="add" accessibilityLabel="Add category" onPress={() => router.push('/categories/add')} />}
        />
        <ChipRow
          value={tab}
          onChange={setTab}
          options={[
            { value: 'all', label: 'All' },
            { value: 'expense', label: 'Expenses' },
            { value: 'income', label: 'Income' },
          ]}
        />
        <Card elevated={false} style={styles.card}>
          {visible.map((item, index) => (
            <Pressable
              key={item.id}
              onPress={() => router.push({ pathname: '/categories/edit', params: { id: item.id } })}
              style={[styles.row, index < visible.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}
            >
              <CategoryIcon icon={item.icon} color={item.color} />
              <View style={styles.body}>
                <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>{item.name}</Text>
                <Text style={{ color: colors.textSecondary }}>{item.type}{item.isDefault ? ' · Default' : ''}</Text>
              </View>
              {spend[item.id] ? (
                <View style={{ alignItems: 'flex-end' }}>
                  <Amount minor={spend[item.id].amount} currency={currency} size="sm" />
                  <Text style={{ color: colors.textTertiary, fontSize: 12 }}>{spend[item.id].percent}% of spending</Text>
                </View>
              ) : null}
              {!item.isDefault ? (
                <Text style={{ color: colors.danger, fontWeight: '700' }} onPress={() => void requestDelete(item.id)}>
                  Delete
                </Text>
              ) : null}
            </Pressable>
          ))}
        </Card>
      </PageScroll>
      <ConfirmDialog
        visible={Boolean(pendingId) && !needsReassign}
        title="Delete category?"
        message="This custom category will be removed."
        confirmLabel="Delete"
        danger
        onCancel={() => setPendingId(null)}
        onConfirm={async () => {
          if (!pendingId) return;
          try {
            await remove(pendingId);
            setPendingId(null);
          } catch (error) {
            Alert.alert('Could not delete', toUserMessage(error, 'Please try again.'));
          }
        }}
      />
      <ConfirmDialog
        visible={Boolean(pendingId) && needsReassign}
        title="Reassign existing records"
        message="This category is in use. Choose another category for those transactions first."
        confirmLabel="Reassign and delete"
        danger
        onCancel={() => setPendingId(null)}
        onConfirm={async () => {
          if (!pendingId) return;
          try {
            await remove(pendingId, reassignTo);
            setPendingId(null);
          } catch (error) {
            Alert.alert('Could not delete', toUserMessage(error, 'Please try again.'));
          }
        }}
      />
      {needsReassign && pendingId ? (
        <View style={styles.reassign}>
          <Select
            label="Move records to"
            value={reassignTo}
            options={categories.filter((item) => item.id !== pendingId).map((item) => ({ value: item.id, label: item.name }))}
            onChange={setReassignTo}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroller: { flex: 1, minHeight: 0 },
  content: { padding: spacing.lg, gap: spacing.md },
  card: { paddingVertical: 4, paddingHorizontal: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 10, paddingHorizontal: 8 },
  body: { flex: 1 },
  reassign: { padding: spacing.lg },
});
