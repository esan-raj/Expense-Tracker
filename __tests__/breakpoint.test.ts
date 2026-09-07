/// <reference types="jest" />
import { DESKTOP_BREAKPOINT, TABLET_BREAKPOINT, breakpointFlags } from '@/utils/breakpoints';

describe('responsive breakpoints', () => {
  it('keeps desktop at 1024 and tablet at 768', () => {
    expect(TABLET_BREAKPOINT).toBe(768);
    expect(DESKTOP_BREAKPOINT).toBe(1024);
    expect(breakpointFlags(360).isPhone).toBe(true);
    expect(breakpointFlags(1440).isDesktop).toBe(true);
  });
});
