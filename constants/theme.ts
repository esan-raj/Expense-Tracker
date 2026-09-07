export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  full: 999,
} as const;

export const typography = {
  display: { fontSize: 34, fontWeight: '700' as const, letterSpacing: -0.8 },
  hero: { fontSize: 32, fontWeight: '700' as const, letterSpacing: -0.7 },
  title: { fontSize: 24, fontWeight: '700' as const, letterSpacing: -0.4 },
  subtitle: { fontSize: 18, fontWeight: '600' as const, letterSpacing: -0.2 },
  section: { fontSize: 17, fontWeight: '700' as const, letterSpacing: -0.2 },
  body: { fontSize: 16, fontWeight: '500' as const },
  secondary: { fontSize: 14, fontWeight: '500' as const },
  caption: { fontSize: 13, fontWeight: '500' as const },
  overline: {
    fontSize: 12,
    fontWeight: '700' as const,
    letterSpacing: 0.7,
    textTransform: 'uppercase' as const,
  },
  numeric: {
    fontSize: 28,
    fontWeight: '700' as const,
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'] as const,
  },
};

export const shadows = {
  light: {
    shadowColor: '#14211C',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 2,
  },
  dark: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 5,
  },
};

export const iconSize = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 28,
} as const;

export const motion = {
  fast: 160,
  normal: 240,
  slow: 420,
} as const;

export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 };
export const minTouchTarget = 44;
export const contentMaxWidth = 1180;
