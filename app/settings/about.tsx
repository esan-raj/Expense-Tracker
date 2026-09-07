import { StyleSheet, Text } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { useTheme } from '@/hooks/useTheme';
import { APP_NAME, APP_VERSION } from '@/utils/constants';

export default function AboutScreen() {
  const { colors } = useTheme();
  return (
    <Screen scroll>
      <Card>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{APP_NAME}</Text>
        <Text style={{ color: colors.textSecondary, marginBottom: 12 }}>Version {APP_VERSION}</Text>
        <Text style={{ color: colors.textPrimary, lineHeight: 24 }}>
          SpendWise is a private, offline-first expense tracker. It helps you record income and spending,
          stay inside monthly budgets, and understand where your money goes — without sending financial
          data to a server.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', marginBottom: 4 },
});
