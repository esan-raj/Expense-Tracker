/** Canonical Wallet S geometry. Keep in sync with `assets/brand/wallet-s.svg`. */

import { mixHex } from '@/utils/accent';

export const WALLET_S_VIEWBOX = '0 0 1024 1024';

export const WALLET_S_MARK_TRANSFORM = 'translate(0 10)';

/** Upper emerald wallet lobe. */
export const WALLET_S_UPPER_D =
  'M462 190H724C763 190 786 214 786 253V348C786 395 762 426 721 431C708 433 696 431 680 427L535 381C495 368 463 394 463 432V527C463 545 451 552 433 547L351 519C278 496 226 440 226 361C226 269 315 190 410 190Z';

/** Lower deep-teal wallet lobe. */
export const WALLET_S_LOWER_D =
  'M506 416C506 411 510 408 516 410L677 459C753 482 790 539 790 612V686C790 747 753 789 693 789H295C249 789 225 764 225 721V612C225 567 251 543 287 543C298 543 309 545 323 550L438 588C472 599 506 575 506 539Z';

/** Card slot on the lower wallet. */
export const WALLET_S_NOTCH = { x: 591, y: 517, width: 120, height: 34, rx: 17 } as const;

export function walletSThemeFills(primary: string, isDark: boolean): { upper: string; lower: string } {
  return {
    upper: primary,
    lower: mixHex(primary, '#000000', isDark ? 0.4 : 0.52),
  };
}

export const WALLET_S_BRAND = {
  emerald: '#11B47B',
  teal: '#004B4E',
  wordmark: '#004B4E',
  plate: '#FAF9F6',
  separator: '#FAF9F6',
  splashBackground: '#FAF9F6',
} as const;
