import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { PageHeader } from '@/components/ui/PageHeader';
import { ChipRow } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Amount } from '@/components/ui/Amount';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { useTheme } from '@/hooks/useTheme';
import { useAccountStore } from '@/store/useAccountStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { accountIcon, accountTypeLabel, isLiabilityAccount } from '@/utils/accountLogic';
import { radius, spacing } from '@/constants/theme';

type AccountTab = 'all' | 'bank' | 'credit_card' | 'investment' | 'cash';

export default function AccountsScreen() {
  const { colors } = useTheme();
  const accounts = useAccountStore((state) => state.accounts);
  const load = useAccountStore((state) => state.load);
  const currency = useSettingsStore((state) => state.settings.currency);
  const [tab, setTab] = useState<AccountTab>('all');

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (tab === 'all') return accounts;
    if (tab === 'bank') return accounts.filter((item) => item.type === 'bank' || item.type === 'wallet' || item.type === 'other');
    return accounts.filter((item) => item.type === tab);
  }, [accounts, tab]);

  return (
    <Screen scroll>
      <PageHeader
        title="Accounts"
        action={<IconButton name="add" accessibilityLabel="Add account" onPress={() => router.push('/accounts/add')} />}
      />
      <ChipRow
        value={tab}
        onChange={setTab}
        options={[
          { value: 'all', label: 'All' },
          { value: 'bank', label: 'Bank' },
          { value: 'credit_card', label: 'Credit cards' },
          { value: 'investment', label: 'Investments' },
          { value: 'cash', label: 'Cash' },
        ]}
      />
      {accounts.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          message="Add a bank account or credit card. Existing transactions stay available until you assign them."
          actionLabel="+ Add account"
          onAction={() => router.push('/accounts/add')}
        />
      ) : visible.length === 0 ? (
        <EmptyState title="Nothing in this tab" message="Try another account type, or add a new account." />
      ) : (
        <Card elevated={false} style={styles.list}>
          {visible.map((item, index) => {
            const liability = isLiabilityAccount(item.type);
            return (
              <Pressable
                key={item.id}
                onPress={() => router.push(`/accounts/${item.id}` as never)}
                accessibilityRole="button"
                accessibilityLabel={item.name}
                style={[styles.row, index < visible.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}
              >
                <View style={[styles.icon, { backgroundColor: colors.primaryMuted }]}>
                  <Ionicons name={accountIcon(item.type)} size={18} color={colors.primary} />
                </View>
                <View style={styles.body}>
                  <Text style={[styles.name, { color: colors.textPrimary }]}>{item.name}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{accountTypeLabel(item.type)}</Text>
                </View>
                <View style={styles.right}>
                  <Amount
                    minor={liability ? item.outstanding : item.currentBalance}
                    currency={currency}
                    size="sm"
                  />
                  {liability && item.utilizationPercent != null ? (
                    <Text style={{ color: colors.textTertiary, fontSize: 12 }}>{item.utilizationPercent.toFixed(2)}% used</Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </Pressable>
            );
          })}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: 4, paddingHorizontal: 8, marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 12, paddingHorizontal: 8 },
  icon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
  name: { fontWeight: '700', fontSize: 16 },
  right: { alignItems: 'flex-end' },
});
