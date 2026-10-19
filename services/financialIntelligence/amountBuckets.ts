import type { AmountBucket } from './types';

export function amountBucket(amountMinor: number): AmountBucket {
  if (amountMinor < 500) return 'b0_500';
  if (amountMinor < 2000) return 'b500_2k';
  if (amountMinor < 10000) return 'b2k_10k';
  return 'b10k_plus';
}
