import * as Haptics from 'expo-haptics';
import { AccessibilityInfo } from 'react-native';

let reduceMotion = false;

AccessibilityInfo.isReduceMotionEnabled()
  .then((value) => {
    reduceMotion = value;
  })
  .catch(() => {
    reduceMotion = false;
  });

AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
  reduceMotion = value;
});

export async function hapticSuccess(): Promise<void> {
  if (reduceMotion) return;
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

export async function hapticWarning(): Promise<void> {
  if (reduceMotion) return;
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
}

export async function hapticError(): Promise<void> {
  if (reduceMotion) return;
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}

export async function hapticLight(): Promise<void> {
  if (reduceMotion) return;
  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}
