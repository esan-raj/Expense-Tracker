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
  md: 16,
  lg: 22,
  xl: 28,
  full: 999,
} as const;

export const typography = {
  display: { fontSize: 34, fontWeight: '700' as const, letterSpacing: -0.8 },
  title: { fontSize: 24, fontWeight: '700' as const, letterSpacing: -0.4 },
  subtitle: { fontSize: 18, fontWeight: '600' as const, letterSpacing: -0.2 },
  body: { fontSize: 16, fontWeight: '500' as const },
  caption: { fontSize: 13, fontWeight: '500' as const },
  overline: {
    fontSize: 12,
    fontWeight: '700' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
};

export const shadows = {
  light: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
  },
  dark: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 6,
  },
};

export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 };
export const minTouchTarget = 44;
