export const ACCENT_PRESETS = [
  { id: 'emerald', label: 'Emerald', light: '#0E7C66', dark: '#3DBAA0' },
  { id: 'ocean', label: 'Ocean', light: '#1B6B8A', dark: '#5BA8C8' },
  { id: 'indigo', label: 'Indigo', light: '#3F4F9C', dark: '#8B96D9' },
  { id: 'violet', label: 'Violet', light: '#6B4C8A', dark: '#B08FD4' },
  { id: 'amber', label: 'Amber', light: '#B7791F', dark: '#E0A84A' },
  { id: 'rose', label: 'Rose', light: '#A84B5A', dark: '#D48996' },
] as const;

export type AccentPresetId = (typeof ACCENT_PRESETS)[number]['id'] | 'custom';

export const DEFAULT_ACCENT_PRESET: AccentPresetId = 'emerald';
export const DEFAULT_ACCENT_COLOR = ACCENT_PRESETS[0].light;

export function isAccentPresetId(value: string): value is Exclude<AccentPresetId, 'custom'> {
  return ACCENT_PRESETS.some((item) => item.id === value);
}

export function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^#?([0-9A-Fa-f]{6})$/);
  if (!match) return null;
  return `#${match[1].toUpperCase()}`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const to = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

export function mixHex(a: string, b: string, amount: number): string {
  const left = hexToRgb(a);
  const right = hexToRgb(b);
  if (!left || !right) return a;
  const t = Math.max(0, Math.min(1, amount));
  return rgbToHex(left.r + (right.r - left.r) * t, left.g + (right.g - left.g) * t, left.b + (right.b - left.b) * t);
}

export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function contrastForeground(hex: string): string {
  return relativeLuminance(hex) > 0.46 ? '#10211C' : '#FFFFFF';
}

export function resolveAccentHex(preset: AccentPresetId, customHex: string, isDark: boolean): string {
  if (preset === 'custom') {
    const normalized = normalizeHex(customHex) ?? DEFAULT_ACCENT_COLOR;
    return isDark ? mixHex(normalized, '#FFFFFF', 0.28) : mixHex(normalized, '#000000', 0.08);
  }
  const found = ACCENT_PRESETS.find((item) => item.id === preset) ?? ACCENT_PRESETS[0];
  return isDark ? found.dark : found.light;
}
