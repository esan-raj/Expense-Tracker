import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { SpendWiseLogo } from '@/components/brand/SpendWiseLogo';
import type { StartupPhase } from '@/services/appStartup';
import { startupStatusLabel } from '@/services/appStartup';

export function StartupScreen({
  phase,
  message,
  onReady,
}: {
  phase: StartupPhase;
  message?: string;
  onReady?: () => void;
}) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const pulse = useRef(new Animated.Value(0.4)).current;
  const announcedRef = useRef<string | null>(null);
  const label = message?.trim() || startupStatusLabel(phase);

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
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  track: { width: 88, height: 4, borderRadius: 2, overflow: 'hidden' },
  bar: { width: '100%', height: '100%' },
  label: { marginTop: 4, fontSize: 15, fontWeight: '600', textAlign: 'center', lineHeight: 22 },
});
