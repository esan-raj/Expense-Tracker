import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface CategoryIconProps {
  icon: string;
  color: string;
  size?: number;
}

export function CategoryIcon({ icon, color, size = 44 }: CategoryIconProps) {
  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: size / 2, backgroundColor: `${color}22` }]}>
      <Ionicons name={(icon as keyof typeof Ionicons.glyphMap) ?? 'ellipse'} size={size * 0.46} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
