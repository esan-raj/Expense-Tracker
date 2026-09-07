import { ScrollView, StyleSheet, type ScrollViewProps } from 'react-native';

export function PageScroll({
  style,
  keyboardShouldPersistTaps = 'handled',
  showsVerticalScrollIndicator = false,
  ...props
}: ScrollViewProps) {
  return (
    <ScrollView
      style={[styles.fill, style]}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      nestedScrollEnabled
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
});
