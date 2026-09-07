export const INVESTMENT_TYPES = ['mutual_fund', 'stocks', 'fixed_deposit', 'gold', 'sip', 'other'] as const;

export type InvestmentType = (typeof INVESTMENT_TYPES)[number];

export function investmentTypeLabel(type: InvestmentType): string {
  switch (type) {
    case 'mutual_fund':
      return 'Mutual Fund';
    case 'stocks':
      return 'Stocks';
    case 'fixed_deposit':
      return 'Fixed Deposit';
    case 'gold':
      return 'Gold';
    case 'sip':
      return 'SIP';
    default:
      return 'Other';
  }
}

export interface Investment {
  id: string;
  name: string;
  type: InvestmentType;
  investedAmount: number;
  currentValue: number;
  investmentDate: string;
  accountId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface InvestmentInput {
  name: string;
  type: InvestmentType;
  investedAmount: number;
  currentValue?: number | null;
  investmentDate: string;
  accountId?: string | null;
  notes?: string | null;
}

export interface InvestmentSummary {
  totalInvested: number;
  currentValue: number;
  returns: number;
  returnPercent: number | null;
  byType: Array<{ type: InvestmentType; investedAmount: number; currentValue: number }>;
}
