import { useWindowDimensions } from 'react-native';
import { breakpointFlags } from '@/utils/breakpoints';

export { DESKTOP_BREAKPOINT, TABLET_BREAKPOINT } from '@/utils/breakpoints';

export function useBreakpoint() {
  const { width } = useWindowDimensions();
  return breakpointFlags(width);
}
