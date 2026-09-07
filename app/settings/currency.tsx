import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/store/useSettingsStore';
import { CURRENCIES, getCurrency } from '@/constants/currencies';
import { WEEK_DAYS } from '@/utils/constants';
import { fromMinorUnits, parseAmountInput, toMinorUnits } from '@/utils/currency';
import { useState } from 'react';

export default function CurrencyScreen() {
  const { colors } = useTheme();
  const settings = useSettingsStore((state) => state.settings);
  const setCurrency = useSettingsStore((state) => state.setCurrency);
  const update = useSettingsStore((state) => state.update);
  const definition = getCurrency(settings.currency);
  const [budget, setBudget] = useState(
    settings.monthlyBudget ? String(fromMinorUnits(settings.monthlyBudget, definition.decimals)) : ''
  );

  return (
    <Screen scroll>
      <Text style={[styles.copy, { color: colors.textSecondary }]}>
        Amounts are stored in the smallest currency unit to keep calculations accurate.
      </Text>
      <Card>
        <View style={styles.list}>
          {CURRENCIES.map((item) => (
            <Button
              key={item.code}
              title={`${item.symbol}  ${item.code}  ·  ${item.name}`}
              variant={settings.currency === item.code ? 'primary' : 'secondary'}
              onPress={() => void setCurrency(item.code)}
            />
          ))}
        </View>
      </Card>
      <Select
        label="First day of week"
        value={String(settings.firstDayOfWeek)}
        options={WEEK_DAYS.map((item) => ({ value: String(item.value), label: item.label }))}
        onChange={(value) => void update({ firstDayOfWeek: Number(value) })}
      />
      <CurrencyInput label="Default monthly budget" value={budget} onChangeText={setBudget} />
      <Button
        title="Save monthly budget"
        onPress={() => {
          const parsed = parseAmountInput(budget);
          void update({
            monthlyBudget: parsed ? toMinorUnits(parsed, definition.decimals) : null,
          });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  copy: { marginBottom: 16, lineHeight: 22 },
  list: { gap: 10 },
});
