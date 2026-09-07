import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/hooks/useTheme';
import { CATEGORY_COLORS, CATEGORY_ICONS } from '@/constants/categories';
import { categoryFormSchema, type CategoryFormValues } from '@/utils/validation';
import type { Category } from '@/types';

interface CategoryFormProps {
  initial?: Category;
  submitting?: boolean;
  onSubmit: (values: CategoryFormValues) => void;
}

export function CategoryForm({ initial, submitting, onSubmit }: CategoryFormProps) {
  const { colors } = useTheme();
  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      name: initial?.name ?? '',
      icon: initial?.icon ?? 'ellipse',
      color: initial?.color ?? CATEGORY_COLORS[0],
      type: initial?.type ?? 'expense',
    },
  });

  return (
    <View style={styles.form}>
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <Input label="Name" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={form.control}
        name="type"
        render={({ field }) => (
          <SegmentedControl
            value={field.value}
            onChange={field.onChange}
            options={[
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' },
              { value: 'both', label: 'Both' },
            ]}
          />
        )}
      />
      <Controller
        control={form.control}
        name="icon"
        render={({ field }) => (
          <View style={styles.grid}>
            {CATEGORY_ICONS.map((icon) => (
              <Pressable
                key={icon}
                onPress={() => field.onChange(icon)}
                accessibilityLabel={icon}
                style={[
                  styles.choice,
                  { borderColor: field.value === icon ? colors.primary : colors.border, backgroundColor: colors.surface },
                ]}
              >
                <Ionicons name={icon} size={20} color={colors.textPrimary} />
              </Pressable>
            ))}
          </View>
        )}
      />
      <Controller
        control={form.control}
        name="color"
        render={({ field }) => (
          <View style={styles.grid}>
            {CATEGORY_COLORS.map((color) => (
              <Pressable
                key={color}
                onPress={() => field.onChange(color)}
                accessibilityLabel={color}
                style={[
                  styles.swatch,
                  { backgroundColor: color, borderColor: field.value === color ? colors.textPrimary : 'transparent' },
                ]}
              />
            ))}
          </View>
        )}
      />
      <Button
        title={initial ? 'Save category' : 'Create category'}
        loading={submitting}
        onPress={form.handleSubmit(onSubmit)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16, paddingBottom: 32 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  choice: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 3 },
});
