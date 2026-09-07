import { StyleSheet, Text } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { useTheme } from '@/hooks/useTheme';

export default function PrivacyScreen() {
  const { colors } = useTheme();
  return (
    <Screen scroll>
      <Card elevated={false}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Your data stays on this device</Text>
        <Text style={[styles.copy, { color: colors.textSecondary }]}>
          SpendWise stores transactions, budgets, and settings in a local RxDB database first. If you sign in,
          your data can sync to your own Supabase project. The app does not include analytics or advertising SDKs.
        </Text>
        <Text style={[styles.copy, { color: colors.textSecondary }]}>
          Export and backup files are created only when you ask for them, and they are shared through the
          system share sheet so you can keep them in a place you control.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '800', marginBottom: 12, letterSpacing: -0.3 },
  copy: { lineHeight: 24, marginBottom: 12 },
});
