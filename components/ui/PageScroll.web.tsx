import { createElement } from 'react';
import { View, type NativeSyntheticEvent, type NativeScrollEvent, type ScrollViewProps } from 'react-native';

export function PageScroll({ children, contentContainerStyle, onScroll }: ScrollViewProps) {
  return createElement(
    'div',
    {
      style: {
        flex: 1,
        minHeight: 0,
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
      },
      onScroll: (event: { currentTarget: HTMLElement }) => {
        if (!onScroll) return;
        const target = event.currentTarget;
        onScroll({
          nativeEvent: {
            contentOffset: { x: target.scrollLeft, y: target.scrollTop },
            contentSize: { width: target.scrollWidth, height: target.scrollHeight },
            layoutMeasurement: { width: target.clientWidth, height: target.clientHeight },
          },
        } as NativeSyntheticEvent<NativeScrollEvent>);
      },
    },
    <View style={contentContainerStyle}>{children}</View>
  );
}
