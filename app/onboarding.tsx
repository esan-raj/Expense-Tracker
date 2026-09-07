import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/store/useSettingsStore';
import { CURRENCIES, getCurrency } from '@/constants/currencies';
import { parseAmountInput, toMinorUnits } from '@/utils/currency';
import { hapticSuccess } from '@/utils/haptics';
import type { CurrencyCode } from '@/types';

export default function OnboardingScreen() {
  const { colors } = useTheme();
  const update = useSettingsStore((state) => state.update);
  const [step, setStep] = useState(0);
  const [currency, setCurrency] = useState<CurrencyCode>('INR');
  const [budget, setBudget] = useState('');

  const finish = async (withBudget: boolean) => {
    const definition = getCurrency(currency);
    const parsed = parseAmountInput(budget);
    await update({
      currency: definition.code,
      currencySymbol: definition.symbol,
      monthlyBudget: withBudget && parsed ? toMinorUnits(parsed, definition.decimals) : null,
      onboardingComplete: true,
    });
    await hapticSuccess();
    router.replace('/(tabs)');
  };

  return (
    <Screen scroll>
      <View style={styles.content}>
        {step === 0 ? (
          <>
            <Text style={[styles.kicker, { color: colors.primary }]}>SpendWise</Text>
            <Text style={[styles.title, { color: colors.textPrimary }]}>Your money, clearly understood.</Text>
            <Text style={[styles.copy, { color: colors.textSecondary }]}>
              Track spending, set budgets, and understand your finances — all stored privately on your device.
            </Text>
            <Button title="Get started" onPress={() => setStep(1)} />
          </>
        ) : null}
        {step === 1 ? (
          <>
            <Text style={[styles.title, { color: colors.textPrimary }]}>Choose your currency</Text>
            <Text style={[styles.copy, { color: colors.textSecondary }]}>You can change this later in Settings.</Text>
            <View style={styles.list}>
              {CURRENCIES.map((item) => (
                <Button
                  key={item.code}
                  title={`${item.symbol}  ${item.code}  ·  ${item.name}`}
                  variant={currency === item.code ? 'primary' : 'secondary'}
                  onPress={() => setCurrency(item.code)}
                />
              ))}
            </View>
            <Button title="Continue" onPress={() => setStep(2)} />
          </>
        ) : null}
        {step === 2 ? (
          <>
            <Text style={[styles.title, { color: colors.textPrimary }]}>Set a monthly budget</Text>
            <Text style={[styles.copy, { color: colors.textSecondary }]}>Optional, but helpful for staying on track.</Text>
            <CurrencyInput value={budget} onChangeText={setBudget} />
            <Button title="Continue" onPress={() => setStep(3)} />
            <Button title="Skip for now" variant="ghost" onPress={() => setStep(3)} />
          </>
        ) : null}
        {step === 3 ? (
          <>
            <Text style={[styles.title, { color: colors.textPrimary }]}>You're all set!</Text>
            <Text style={[styles.copy, { color: colors.textSecondary }]}>
              Start tracking your expenses and keep every rupee — or dollar — in view.
            </Text>
            <Button title="Start tracking" onPress={() => void finish(Boolean(budget))} />
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'center', gap: 18, paddingTop: 48 },
  kicker: { fontSize: 16, fontWeight: '800', letterSpacing: 1 },
  title: { fontSize: 34, fontWeight: '800', letterSpacing: -0.8, lineHeight: 40 },
  copy: { fontSize: 16, lineHeight: 24 },
  list: { gap: 10 },
});
