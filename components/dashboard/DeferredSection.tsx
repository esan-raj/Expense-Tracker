import { useEffect, useState, type ReactNode } from 'react';
import { InteractionManager, View } from 'react-native';
import { Skeleton } from '@/components/ui/Skeleton';

export function DeferredSection({
  height,
  children,
}: {
  height: number;
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      setReady(true);
    });
    return () => handle.cancel();
  }, []);

  if (!ready) {
    return (
      <View style={{ height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Skeleton height={height} />
      </View>
    );
  }

  return <>{children}</>;
}
