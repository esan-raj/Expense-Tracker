import { StyleSheet, Text } from 'react-native';
import * as Updates from 'expo-updates';
import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { useTheme } from '@/hooks/useTheme';
<<<<<<< HEAD
import { APP_VERSION } from '@/utils/constants';
=======
import { APP_NAME, APP_VERSION } from '@/utils/constants';
import { previewUpdateVerificationLabel } from '@/utils/previewUpdateMarker';
>>>>>>> fdf8923d73e86c9e731382cb3a0cf14dca08e516

export default function AboutScreen() {
  const { colors } = useTheme();
  const previewVerification = previewUpdateVerificationLabel(Updates.channel);

  return (
    <Screen scroll>
      <Card elevated={false}>
        <BrandLockup size={48} notchColor={colors.surface} />
        <Text style={[styles.title, { color: colors.textPrimary }]}>Your money, clearly understood.</Text>
        <Text style={{ color: colors.textSecondary, marginBottom: 12 }}>Version {APP_VERSION}</Text>
        {previewVerification ? (
          <Text
            accessibilityRole="text"
            accessibilityLabel={previewVerification}
            style={{ color: colors.textSecondary, marginBottom: 12 }}
          >
            {previewVerification}
          </Text>
        ) : null}
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
