import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme } from '@/hooks/useTheme';
import { radius } from '@/constants/theme';

interface ProgressBarProps {
  progress: number;
  tone?: 'primary' | 'warning' | 'danger' | 'success';
}

export function ProgressBar({ progress, tone = 'primary' }: ProgressBarProps) {
  const { colors } = useTheme();
  const width = useSharedValue(0);
  const toneColor = {
    primary: colors.primary,
    warning: colors.warning,
    danger: colors.danger,
    success: colors.success,
  }[tone];

  useEffect(() => {
    width.value = withTiming(Math.max(0, Math.min(progress, 1)), { duration: 420 });
  }, [progress, width]);

  const animated = useAnimatedStyle(() => ({
    width: `${width.value * 100}%`,
  }));

  return (
    <View style={[styles.track, { backgroundColor: colors.progressTrack }]} accessibilityRole="progressbar">
      <Animated.View style={[styles.fill, { backgroundColor: toneColor }, animated]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 10, borderRadius: radius.full, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.full },
});
