import { FinancialAssistantError } from './errors.ts';

export function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new FinancialAssistantError('invalid_request', `${label} must be an object`, 400);
  }
  return value as Record<string, unknown>;
}

export function assertExactKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void {
  const allowedSet = new Set(allowed);
  const keys = Object.keys(obj);
  const unknown = keys.filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new FinancialAssistantError(
      'invalid_request',
      `${label} has unknown fields: ${unknown.slice(0, 8).join(', ')}`,
      400
    );
  }
  for (const key of allowed) {
    if (!(key in obj)) {
      throw new FinancialAssistantError('invalid_request', `${label}.${key} is required`, 400);
    }
  }
}

export function assertOptionalExactKeys(
  obj: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string
): void {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(obj).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new FinancialAssistantError(
      'invalid_request',
      `${label} has unknown fields: ${unknown.slice(0, 8).join(', ')}`,
      400
    );
  }
  for (const key of required) {
    if (!(key in obj)) {
      throw new FinancialAssistantError('invalid_request', `${label}.${key} is required`, 400);
    }
  }
}

export function assertBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new FinancialAssistantError('invalid_request', `${label} must be a boolean`, 400);
  }
  return value;
}

export function assertSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new FinancialAssistantError('invalid_request', `${label} must be a safe integer`, 400);
  }
  return value;
}

export function assertNonNegativeSafeInteger(value: unknown, label: string): number {
  const n = assertSafeInteger(value, label);
  if (n < 0) {
    throw new FinancialAssistantError('invalid_request', `${label} must be non-negative`, 400);
  }
  return n;
}

export function assertString(value: unknown, label: string, maxLen?: number): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new FinancialAssistantError('invalid_request', `${label} must be a non-empty string`, 400);
  }
  if (maxLen != null && value.length > maxLen) {
    throw new FinancialAssistantError('invalid_request', `${label} exceeds ${maxLen} characters`, 400);
  }
  return value;
}

export function assertArray(value: unknown, label: string, maxLen: number): unknown[] {
  if (!Array.isArray(value)) {
    throw new FinancialAssistantError('invalid_request', `${label} must be an array`, 400);
  }
  if (value.length > maxLen) {
    throw new FinancialAssistantError('invalid_request', `${label} exceeds max length ${maxLen}`, 400);
  }
  return value;
}

export function assertNullOr<T>(
  value: unknown,
  label: string,
  parse: (value: unknown, label: string) => T
): T | null {
  if (value === null) return null;
  return parse(value, label);
}
