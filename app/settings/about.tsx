import { StyleSheet, Text } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { useTheme } from '@/hooks/useTheme';
import { APP_VERSION } from '@/utils/constants';

export default function AboutScreen() {
  const { colors } = useTheme();
  return (
    <Screen scroll>
      <Card elevated={false}>
        <BrandLockup size={48} notchColor={colors.surface} />
        <Text style={[styles.title, { color: colors.textPrimary }]}>Your money, clearly understood.</Text>
        <Text style={{ color: colors.textSecondary, marginBottom: 12 }}>Version {APP_VERSION}</Text>
        <Text style={{ color: colors.textPrimary, lineHeight: 24 }}>
          SpendWise is a private, offline-first expense tracker. It helps you record income and spending,
          stay inside monthly budgets, and understand where your money goes.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5, marginTop: 12, marginBottom: 8 },
});
