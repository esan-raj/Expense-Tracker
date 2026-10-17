import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { getReduceMotionPreferred } from '@/utils/haptics';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(getReduceMotionPreferred);

  useEffect(() => {
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduced)
      .catch(() => undefined);
    return () => sub.remove();
  }, []);

  return reduced;
}
