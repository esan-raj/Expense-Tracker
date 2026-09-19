import type { AccountType, PaymentMethod } from '@/types';
import { isCashHolding } from '@/utils/accountLogic';

export function transferPaymentMethod(sourceType: AccountType, destinationType: AccountType): PaymentMethod {
  if (sourceType === 'credit_card' || destinationType === 'credit_card') {
    return 'bank_transfer';
  }
  if (isCashHolding(sourceType) || isCashHolding(destinationType)) {
    return 'cash';
  }
  return 'bank_transfer';
}

export function transferLegTitles(
  source: { name: string; type: AccountType },
  destination: { name: string; type: AccountType },
  customTitle?: string | null
): { sourceTitle: string; destTitle: string } {
  const custom = customTitle?.trim();
  if (custom) {
    return { sourceTitle: custom, destTitle: custom };
  }
  if (source.type === 'credit_card' || destination.type === 'credit_card') {
    return {
      sourceTitle: `Transfer to ${destination.name}`,
      destTitle: `Transfer from ${source.name}`,
    };
  }
  if (!isCashHolding(source.type) && isCashHolding(destination.type)) {
    return {
      sourceTitle: `Cash withdrawal · ${destination.name}`,
      destTitle: `Cash from ${source.name}`,
    };
  }
  if (isCashHolding(source.type) && !isCashHolding(destination.type)) {
    return {
      sourceTitle: `Cash deposit · ${destination.name}`,
      destTitle: `Cash from ${source.name}`,
    };
  }
  if (isCashHolding(source.type) && isCashHolding(destination.type)) {
    return {
      sourceTitle: `Move cash · ${destination.name}`,
      destTitle: `Cash from ${source.name}`,
    };
  }
  return {
    sourceTitle: `Transfer to ${destination.name}`,
    destTitle: `Transfer from ${source.name}`,
  };
}
