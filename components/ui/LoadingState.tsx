import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { SpendWiseLogo } from '@/components/brand/SpendWiseLogo';

export function LoadingState({
  message = 'Loading your finances…',
  onReady,
}: {
  message?: string;
  onReady?: () => void;
}) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const pulse = useRef(new Animated.Value(0.4)).current;

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

  return (
    <View
      style={[styles.wrap, { backgroundColor: colors.background }]}
      accessibilityLabel={message}
      onLayout={() => onReady?.()}
    >
      <SpendWiseLogo size={72} notchColor={colors.background} />
      <View style={[styles.track, { backgroundColor: colors.progressTrack }]}>
        <Animated.View
          style={[styles.bar, { backgroundColor: colors.primary, opacity: pulse }]}
        />
      </View>
      <Text style={{ color: colors.textSecondary, marginTop: 4 }}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  track: { width: 72, height: 4, borderRadius: 2, overflow: 'hidden' },
  bar: { width: '100%', height: '100%' },
});
