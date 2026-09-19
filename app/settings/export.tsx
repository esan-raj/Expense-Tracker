import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useTransactionStore } from '@/store/useTransactionStore';
import { beginCriticalWork } from '@/store/useCriticalWorkStore';
import { exportService } from '@/services/exportService';
import { toUserMessage } from '@/utils/errors';

export default function ExportScreen() {
  const { colors } = useTheme();
  const currency = useSettingsStore((state) => state.settings.currency);
  const reload = useTransactionStore((state) => state.load);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!busy) return;
    return beginCriticalWork('csv-import-export');
  }, [busy]);

  return (
    <Screen scroll>
      <Card elevated={false}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>CSV export</Text>
        <Text style={{ color: colors.textSecondary, lineHeight: 22, marginBottom: 16 }}>
          Share a spreadsheet containing date, type, title, category, amount, payment method, and notes.
        </Text>
        <Button
          title="Export transactions"
          loading={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await exportService.exportCsv(currency);
            } catch (error) {
              Alert.alert('Export failed', toUserMessage(error, 'Please try again.'));
            } finally {
              setBusy(false);
            }
          }}
        />
      </Card>
      <Card elevated={false}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>CSV import</Text>
        <Text style={{ color: colors.textSecondary, lineHeight: 22, marginBottom: 16 }}>
          Import a previously exported SpendWise CSV. Existing transactions are kept.
        </Text>
        <Button
          title="Import transactions"
          variant="secondary"
          loading={busy}
          onPress={async () => {
            setBusy(true);
            try {
              const count = await exportService.importCsv(currency);
              if (count > 0) {
                await reload();
                Alert.alert('Import complete', `${count} transactions were added.`);
              }
            } catch (error) {
              Alert.alert('Import failed', toUserMessage(error, 'Please try again.'));
            } finally {
              setBusy(false);
            }
          }}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
});
