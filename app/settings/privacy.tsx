import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/store/useSettingsStore';
import {
  CLOUD_AI_ENABLE_CONFIRM_MESSAGE,
  CLOUD_AI_ENABLE_CONFIRM_TITLE,
  CLOUD_AI_PRIVACY_DISCLOSURE,
  CLOUD_AI_PRIVACY_TITLE,
  CLOUD_AI_SWITCH_ACCESSIBILITY_HINT,
  CLOUD_AI_SWITCH_ACCESSIBILITY_LABEL,
  reduceCloudAiConsentUi,
  type CloudAiConsentUiState,
} from '@/services/aiAssistant';

export default function PrivacyScreen() {
  const { colors } = useTheme();
  const aiCloudEnabled = useSettingsStore((state) => state.settings.aiCloudEnabled);
  const setCloudAiConsent = useSettingsStore((state) => state.setCloudAiConsent);
  const [ui, setUi] = useState<CloudAiConsentUiState>({
    enabled: aiCloudEnabled,
    confirmVisible: false,
  });

  useEffect(() => {
    setUi((current) => ({ ...current, enabled: aiCloudEnabled }));
  }, [aiCloudEnabled]);

  const onSwitch = (next: boolean) => {
    if (next) {
      setUi((current) => reduceCloudAiConsentUi(current, { type: 'toggle_on' }));
      return;
    }
    setUi((current) => reduceCloudAiConsentUi(current, { type: 'toggle_off' }));
    void setCloudAiConsent(false);
  };

  const onConfirmEnable = () => {
    setUi((current) => reduceCloudAiConsentUi(current, { type: 'confirm_enable' }));
    void setCloudAiConsent(true);
  };

  const onCancelEnable = () => {
    setUi((current) => reduceCloudAiConsentUi(current, { type: 'cancel_enable' }));
  };

  const statusLabel = ui.enabled
    ? 'Cloud AI is enabled on this device (policy version 1).'
    : 'Cloud AI is disabled on this device.';

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

      <Card elevated={false}>
        <Text
          accessibilityRole="header"
          style={[styles.sectionTitle, { color: colors.textPrimary }]}
        >
          {CLOUD_AI_PRIVACY_TITLE}
        </Text>
        <Text style={[styles.copy, { color: colors.textSecondary }]}>{CLOUD_AI_PRIVACY_DISCLOSURE}</Text>
        <View style={[styles.row, { borderTopColor: colors.border }]}>
          <View style={styles.rowText}>
            <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>Allow cloud AI</Text>
            <Text style={{ color: colors.textSecondary, marginTop: 4 }}>{statusLabel}</Text>
          </View>
          <Switch
            value={ui.enabled}
            onValueChange={onSwitch}
            accessibilityLabel={CLOUD_AI_SWITCH_ACCESSIBILITY_LABEL}
            accessibilityHint={CLOUD_AI_SWITCH_ACCESSIBILITY_HINT}
            accessibilityRole="switch"
            trackColor={{ false: colors.border, true: colors.primaryMuted }}
            thumbColor={ui.enabled ? colors.primary : colors.surfaceElevated}
          />
        </View>
      </Card>

      <ConfirmDialog
        visible={ui.confirmVisible}
        title={CLOUD_AI_ENABLE_CONFIRM_TITLE}
        message={CLOUD_AI_ENABLE_CONFIRM_MESSAGE}
        confirmLabel="Enable"
        onConfirm={onConfirmEnable}
        onCancel={onCancelEnable}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '800', marginBottom: 12, letterSpacing: -0.3 },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginBottom: 12, letterSpacing: -0.2 },
  copy: { lineHeight: 24, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 16,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1 },
});
