export function normalizeOptionLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function optionLabelsMatch(left: string, right: string): boolean {
  return normalizeOptionLabel(left) === normalizeOptionLabel(right);
}

export function displayOptionLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function isCreatableOptionLabel(value: string, maxLength = 40): boolean {
  const label = displayOptionLabel(value);
  return label.length >= 1 && label.length <= maxLength;
}

export function findOptionByLabel<T extends { label: string }>(options: T[], query: string): T | undefined {
  const needle = normalizeOptionLabel(query);
  if (!needle) return undefined;
  return options.find((option) => normalizeOptionLabel(option.label) === needle);
}

export function filterOptions<T extends { label: string }>(options: T[], query: string): T[] {
  const needle = normalizeOptionLabel(query);
  if (!needle) return options;
  return options.filter((option) => normalizeOptionLabel(option.label).includes(needle));
}
