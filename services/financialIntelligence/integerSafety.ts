export class FinancialSnapshotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinancialSnapshotValidationError';
  }
}

export function assertSafeInteger(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new FinancialSnapshotValidationError(`${label} must be a safe integer`);
  }
  return value;
}

export function safeAdd(a: number, b: number, label = 'aggregate'): number {
  assertSafeInteger(a, label);
  assertSafeInteger(b, label);
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new FinancialSnapshotValidationError(`${label} overflowed Number.MAX_SAFE_INTEGER`);
  }
  return sum;
}

export function safeMultiply(a: number, b: number, label = 'aggregate'): number {
  assertSafeInteger(a, label);
  assertSafeInteger(b, label);
  const product = a * b;
  if (!Number.isSafeInteger(product)) {
    throw new FinancialSnapshotValidationError(`${label} overflowed Number.MAX_SAFE_INTEGER`);
  }
  return product;
}
