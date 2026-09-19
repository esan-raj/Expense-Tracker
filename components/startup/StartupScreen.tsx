import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { SpendWiseLogo } from '@/components/brand/SpendWiseLogo';
import type { StartupPhase } from '@/services/appStartup';
import { startupStatusLabel } from '@/services/appStartup';

export function StartupScreen({
  phase,
  message,
  onReady,
  onRetry,
}: {
  phase: StartupPhase;
  message?: string;
  onReady?: () => void;
  onRetry?: () => void;
}) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const pulse = useRef(new Animated.Value(0.4)).current;
  const announcedRef = useRef<string | null>(null);
  const label =
    phase === 'recoverable-error'
      ? startupStatusLabel(phase)
      : message?.trim() || startupStatusLabel(phase);
  const showRetry = phase === 'recoverable-error' && typeof onRetry === 'function';

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0.7);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  useEffect(() => {
    if (!label || announcedRef.current === label) return;
    announcedRef.current = label;
    void AccessibilityInfo.announceForAccessibility(label);
  }, [label]);

  return (
    <View
      style={[styles.wrap, { backgroundColor: colors.background }]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      onLayout={() => onReady?.()}
    >
      <SpendWiseLogo size={88} notchColor={colors.background} />
      <View style={[styles.track, { backgroundColor: colors.progressTrack }]}>
        <Animated.View style={[styles.bar, { backgroundColor: colors.primary, opacity: pulse }]} />
      </View>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      {showRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry starting SpendWise"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.retry,
            { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.retryLabel, { color: colors.onPrimary }]}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  track: { width: 88, height: 4, borderRadius: 2, overflow: 'hidden' },
  bar: { width: '100%', height: '100%' },
  label: { marginTop: 4, fontSize: 15, fontWeight: '600', textAlign: 'center', lineHeight: 22 },
  retry: {
    marginTop: 8,
    minWidth: 140,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  retryLabel: { fontSize: 15, fontWeight: '700' },
});
