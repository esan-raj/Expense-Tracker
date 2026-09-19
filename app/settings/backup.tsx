import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useTheme } from '@/hooks/useTheme';
import { backupService } from '@/services/backupService';
import { dataService } from '@/services/dataService';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useCategoryStore } from '@/store/useCategoryStore';
import { useTransactionStore } from '@/store/useTransactionStore';
import { useBudgetStore } from '@/store/useBudgetStore';
import { useAccountStore } from '@/store/useAccountStore';
import { beginCriticalWork } from '@/store/useCriticalWorkStore';
import { toUserMessage } from '@/utils/errors';
import type { BackupPayload } from '@/utils/validation';

export default function BackupScreen() {
  const { colors } = useTheme();
  const reloadSettings = useSettingsStore((state) => state.load);
  const reloadCategories = useCategoryStore((state) => state.load);
  const reloadTransactions = useTransactionStore((state) => state.load);
  const reloadBudgets = useBudgetStore((state) => state.load);
  const reloadAccounts = useAccountStore((state) => state.load);
  const [payload, setPayload] = useState<BackupPayload | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!payload && !busy && !clearOpen) return;
    return beginCriticalWork('backup-restore');
  }, [payload, busy, clearOpen]);

  const refreshAll = async () => {
    await Promise.all([reloadSettings(), reloadCategories(), reloadAccounts(), reloadTransactions(), reloadBudgets()]);
  };

  return (
    <Screen scroll>
      <Card elevated={false}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Create backup</Text>
        <Text style={[styles.copy, { color: colors.textSecondary }]}>Saves transactions, accounts, categories, budgets, recurring items, and settings as JSON.</Text>
        <Button
          title="Create backup"
          loading={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await backupService.createBackup();
            } catch (error) {
              Alert.alert('Backup failed', toUserMessage(error, 'Please try again.'));
            } finally {
              setBusy(false);
            }
          }}
        />
      </Card>
      <Card elevated={false}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Restore backup</Text>
        <Text style={[styles.copy, { color: colors.textSecondary }]}>The file is validated first. Restore replaces current data only after you confirm.</Text>
        <Button
          title="Choose backup file"
          variant="secondary"
          onPress={async () => {
            try {
              setPayload(await backupService.pickBackup());
            } catch (error) {
              Alert.alert('Invalid backup', toUserMessage(error, 'Please choose a valid SpendWise backup.'));
            }
          }}
        />
      </Card>
      <Card elevated={false}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Sample data</Text>
        <Text style={[styles.copy, { color: colors.textSecondary }]}>Adds realistic development transactions without replacing your categories.</Text>
        <Button
          title="Load sample data"
          variant="secondary"
          onPress={async () => {
            try {
              await dataService.loadSampleData();
              await refreshAll();
              Alert.alert('Sample data added', 'Example transactions and budgets are now available.');
            } catch (error) {
              Alert.alert('Could not load sample data', toUserMessage(error, 'Please try again.'));
            }
          }}
        />
      </Card>
      <Button title="Clear all data" variant="danger" onPress={() => setClearOpen(true)} />
      <ConfirmDialog
        visible={Boolean(payload)}
        title="Restore this backup?"
        message="This replaces your current SpendWise data with the selected backup."
        confirmLabel="Restore"
        danger
        onCancel={() => setPayload(null)}
        onConfirm={async () => {
          if (!payload) return;
          try {
            await backupService.restore(payload);
            await refreshAll();
            setPayload(null);
            Alert.alert('Restore complete', 'Your backup has been restored.');
          } catch (error) {
            Alert.alert('Restore failed', toUserMessage(error, 'Your existing data was kept.'));
          }
        }}
      />
      <ConfirmDialog
        visible={clearOpen}
        title="Clear all data?"
        message="Transactions, budgets, and recurring items will be deleted. Categories and settings stay."
        confirmLabel="Clear data"
        danger
        onCancel={() => setClearOpen(false)}
        onConfirm={async () => {
          await dataService.clearAll();
          await refreshAll();
          setClearOpen(false);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  copy: { lineHeight: 22, marginBottom: 16 },
});
