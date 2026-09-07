export const DESKTOP_BREAKPOINT = 1024;
export const TABLET_BREAKPOINT = 768;

export function breakpointFlags(width: number) {
  return {
    width,
    isPhone: width < TABLET_BREAKPOINT,
    isTablet: width >= TABLET_BREAKPOINT && width < DESKTOP_BREAKPOINT,
    isDesktop: width >= DESKTOP_BREAKPOINT,
    isWide: width >= TABLET_BREAKPOINT,
  };
}
