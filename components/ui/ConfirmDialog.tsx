import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { Button } from './Button';

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={[styles.overlay, { backgroundColor: colors.overlay }]} onPress={onCancel}>
        <Pressable style={[styles.card, { backgroundColor: colors.surfaceElevated }]} onPress={() => undefined}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
          <Text style={{ color: colors.textSecondary, lineHeight: 22 }}>{message}</Text>
          <View style={styles.actions}>
            <View style={styles.flex}>
              <Button title="Cancel" variant="secondary" onPress={onCancel} />
            </View>
            <View style={styles.flex}>
              <Button title={confirmLabel} variant={danger ? 'danger' : 'primary'} onPress={onConfirm} />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', padding: 24, alignItems: 'center' },
  card: { borderRadius: 24, padding: 22, gap: 12, width: '100%', maxWidth: 440 },
  title: { fontSize: 20, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  flex: { flex: 1 },
});
