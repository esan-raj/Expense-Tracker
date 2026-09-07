import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { PageScroll } from '@/components/ui/PageScroll';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Select } from '@/components/ui/Select';
import { CategoryIcon } from '@/components/categories/CategoryIcon';
import { useTheme } from '@/hooks/useTheme';
import { useCategoryStore } from '@/store/useCategoryStore';
import { categoryService } from '@/services/categoryService';
import { toUserMessage } from '@/utils/errors';

export default function CategoriesScreen() {
  const { colors } = useTheme();
  const { categories, remove } = useCategoryStore();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [reassignTo, setReassignTo] = useState<string>('');
  const [needsReassign, setNeedsReassign] = useState(false);

  const requestDelete = async (id: string) => {
    const usage = await categoryService.usage(id);
    setPendingId(id);
    setNeedsReassign(usage.total > 0);
    setReassignTo(categories.find((item) => item.id !== id)?.id ?? '');
  };

  return (
    <Screen padded={false}>
      <PageScroll style={styles.scroller} contentContainerStyle={styles.content}>
        <Button title="Add category" onPress={() => router.push('/categories/add')} />
        <Card>
          {categories.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => router.push({ pathname: '/categories/edit', params: { id: item.id } })}
              style={styles.row}
            >
              <CategoryIcon icon={item.icon} color={item.color} />
              <View style={styles.body}>
                <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>{item.name}</Text>
                <Text style={{ color: colors.textSecondary }}>{item.type}{item.isDefault ? ' · Default' : ''}</Text>
              </View>
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
  content: { padding: 16, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  body: { flex: 1 },
  reassign: { padding: 16 },
});
