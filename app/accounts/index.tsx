import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useTheme } from '@/hooks/useTheme';
import { useAccountStore } from '@/store/useAccountStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { formatMoney } from '@/utils/currency';
import { accountIcon, accountTypeLabel, isLiabilityAccount } from '@/utils/accountLogic';
import { useBreakpoint } from '@/hooks/useBreakpoint';

export default function AccountsScreen() {
  const { colors } = useTheme();
  const { isWide } = useBreakpoint();
  const accounts = useAccountStore((state) => state.accounts);
  const load = useAccountStore((state) => state.load);
  const currency = useSettingsStore((state) => state.settings.currency);

  useEffect(() => {
    void load();
  }, [load]);

  const banks = accounts.filter((item) => !isLiabilityAccount(item.type));
  const cards = accounts.filter((item) => isLiabilityAccount(item.type));

  return (
    <Screen scroll>
      <Button title="+ Add Account" onPress={() => router.push('/accounts/add')} />
      {accounts.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          message="Add a bank account or credit card. Existing transactions stay available until you assign them."
        />
      ) : null}
      {banks.length > 0 ? (
        <Card>
          <Text style={[styles.heading, { color: colors.textPrimary }]}>Bank Accounts</Text>
          <View style={isWide ? styles.grid : undefined}>
          {banks.map((item) => (
            <Pressable key={item.id} onPress={() => router.push(`/accounts/${item.id}` as never)} style={[styles.row, isWide && styles.tile]}>
              <Ionicons name={accountIcon(item.type)} size={22} color={colors.primary} />
              <View style={styles.flex}>
                <Text style={[styles.name, { color: colors.textPrimary }]}>{item.name}</Text>
                <Text style={{ color: colors.textSecondary }}>{accountTypeLabel(item.type)}</Text>
              </View>
              <Text style={[styles.amount, { color: colors.textPrimary }]}>{formatMoney(item.currentBalance, currency)}</Text>
            </Pressable>
          ))}
          </View>
        </Card>
      ) : null}
      {cards.length > 0 ? (
        <Card>
          <Text style={[styles.heading, { color: colors.textPrimary }]}>Credit Cards</Text>
          <View style={isWide ? styles.grid : undefined}>
          {cards.map((item) => (
            <Pressable key={item.id} onPress={() => router.push(`/accounts/${item.id}` as never)} style={[styles.row, isWide && styles.tile]}>
              <Ionicons name="card" size={22} color={colors.primary} />
              <View style={styles.flex}>
                <Text style={[styles.name, { color: colors.textPrimary }]}>{item.name}</Text>
                <Text style={{ color: colors.textSecondary }}>
                  {formatMoney(item.outstanding, currency)} outstanding
                </Text>
              </View>
              <Text style={{ color: colors.textSecondary }}>
                {item.availableCredit != null ? `${formatMoney(item.availableCredit, currency)} available` : ''}
              </Text>
            </Pressable>
          ))}
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 16, fontWeight: '800', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  flex: { flex: 1 },
  name: { fontWeight: '700', fontSize: 16 },
  amount: { fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '48%', minWidth: 240, padding: 8 },
});
