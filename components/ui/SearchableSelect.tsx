import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { radius, spacing } from '@/constants/theme';
import {
  displayOptionLabel,
  filterOptions,
  findOptionByLabel,
  isCreatableOptionLabel,
} from '@/utils/optionLabel';
import { toUserMessage } from '@/utils/errors';

export interface SearchableSelectOption<T extends string = string> {
  value: T;
  label: string;
}

export interface SearchableSelectAction {
  label: string;
  onPress: () => void;
}

export function SearchableSelect<T extends string>({
  label,
  value,
  placeholder = 'Select',
  options,
  onChange,
  error,
  allowCreate = false,
  onCreate,
  creatingLabel = 'Saving…',
  maxLength = 40,
  actions,
}: {
  label: string;
  value?: T;
  placeholder?: string;
  options: SearchableSelectOption<T>[];
  onChange: (value: T) => void;
  error?: string;
  allowCreate?: boolean;
  onCreate?: (label: string) => Promise<T>;
  creatingLabel?: string;
  maxLength?: number;
  actions?: SearchableSelectAction[];
}) {
  const { colors } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const selected = options.find((item) => item.value === value);
  const filtered = useMemo(() => filterOptions(options, query), [options, query]);
  const exactMatch = findOptionByLabel(options, query);
  const canCreate =
    allowCreate &&
    Boolean(onCreate) &&
    isCreatableOptionLabel(query, maxLength) &&
    !exactMatch;
  const createText = `Create “${displayOptionLabel(query)}”`;
  const rows = canCreate ? filtered.length + 1 : filtered.length;

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(handle);
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setCreateError(null);
    setCreating(false);
    setHighlighted(0);
  };

  const select = (next: T) => {
    onChange(next);
    close();
  };

  const create = async () => {
    if (!onCreate || !canCreate || creating) return;
    setCreating(true);
    setCreateError(null);
    const labelToCreate = displayOptionLabel(query);
    try {
      const existing = findOptionByLabel(options, labelToCreate);
      if (existing) {
        select(existing.value);
        return;
      }
      const created = await onCreate(labelToCreate);
      onChange(created);
      close();
    } catch (err) {
      setCreateError(toUserMessage(err, 'We could not save this option. Try again.'));
    } finally {
      setCreating(false);
    }
  };

  const confirmHighlighted = () => {
    if (canCreate && highlighted === filtered.length) {
      void create();
      return;
    }
    const option = filtered[highlighted];
    if (option) select(option.value);
  };

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="combobox"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        style={[styles.field, { backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.border }]}
      >
        <Text style={{ color: selected ? colors.textPrimary : colors.textTertiary, fontSize: 16, flex: 1 }} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
      </Pressable>
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={[styles.overlay, { backgroundColor: colors.overlay }]} onPress={close}>
            <Pressable
              onPress={() => undefined}
              style={[styles.sheet, { backgroundColor: colors.surfaceElevated }]}
              accessibilityViewIsModal
            >
              <Text style={[styles.title, { color: colors.textPrimary }]}>{label}</Text>
              <TextInput
                ref={inputRef}
                value={query}
                onChangeText={(text) => {
                  setQuery(text);
                  setCreateError(null);
                  setHighlighted(0);
                }}
                placeholder="Search"
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel={`Search ${label}`}
                autoCorrect={false}
                autoCapitalize="sentences"
                autoComplete="off"
                importantForAutofill="no"
                maxLength={maxLength}
                onSubmitEditing={confirmHighlighted}
                blurOnSubmit={false}
                onKeyPress={(event) => {
                  const key = event.nativeEvent.key;
                  if (key === 'Escape') {
                    close();
                    return;
                  }
                  if (key === 'ArrowDown') {
                    event.preventDefault?.();
                    setHighlighted((index) => Math.min(index + 1, Math.max(rows - 1, 0)));
                    return;
                  }
                  if (key === 'ArrowUp') {
                    event.preventDefault?.();
                    setHighlighted((index) => Math.max(index - 1, 0));
                  }
                }}
                style={[
                  styles.search,
                  {
                    backgroundColor: colors.surfaceSecondary,
                    color: colors.textPrimary,
                    borderColor: colors.border,
                  },
                ]}
              />
              <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
                {filtered.map((option, index) => (
                  <Pressable
                    key={option.value}
                    onPress={() => select(option.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: option.value === value }}
                    style={[
                      styles.option,
                      highlighted === index && { backgroundColor: colors.primaryMuted },
                    ]}
                  >
                    <Text style={{ color: colors.textPrimary, fontSize: 16, flex: 1 }}>{option.label}</Text>
                    {option.value === value ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
                  </Pressable>
                ))}
                {canCreate ? (
                  <Pressable
                    onPress={() => void create()}
                    disabled={creating}
                    accessibilityRole="button"
                    accessibilityLabel={createText}
                    style={[
                      styles.option,
                      highlighted === filtered.length && { backgroundColor: colors.primaryMuted },
                    ]}
                  >
                    {creating ? (
                      <View style={styles.creating}>
                        <ActivityIndicator size="small" color={colors.primary} />
                        <Text style={{ color: colors.primary, fontWeight: '700' }}>{creatingLabel}</Text>
                      </View>
                    ) : (
                      <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 16 }}>{createText}</Text>
                    )}
                  </Pressable>
                ) : null}
                {filtered.length === 0 && !canCreate ? (
                  <Text style={[styles.empty, { color: colors.textSecondary }]}>No matching options</Text>
                ) : null}
              </ScrollView>
              {createError ? (
                <View style={styles.createError}>
                  <Text style={{ color: colors.danger, flex: 1 }} accessibilityLiveRegion="polite">
                    {createError}
                  </Text>
                  <Pressable
                    onPress={() => void create()}
                    accessibilityRole="button"
                    accessibilityLabel="Try creating this option again"
                    disabled={creating}
                  >
                    <Text style={{ color: colors.primary, fontWeight: '700' }}>Try again</Text>
                  </Pressable>
                </View>
              ) : null}
              {actions?.length ? (
                <View style={styles.actions}>
                  {actions.map((action) => (
                    <Pressable
                      key={action.label}
                      onPress={() => {
                        close();
                        action.onPress();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={action.label}
                      style={[styles.action, { borderColor: colors.border }]}
                    >
                      <Text style={{ color: colors.primary, fontWeight: '700' }}>{action.label}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {rows === 0 ? null : (
                <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 8 }}>
                  {Platform.OS === 'web' ? 'Type to search. Enter selects or creates.' : 'Type to search. Tap Create to add a new option.'}
                </Text>
              )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  flex: { flex: 1 },
  label: { fontSize: 13, fontWeight: '600' },
  field: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '80%' },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  search: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    fontSize: 16,
    marginBottom: 8,
  },
  list: { maxHeight: 320 },
  option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, paddingHorizontal: 8 },
  empty: { paddingVertical: 16, textAlign: 'center' },
  creating: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  createError: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  actions: { marginTop: 8, gap: 8 },
  action: { minHeight: 44, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
