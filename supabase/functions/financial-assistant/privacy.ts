/** Keys that must never appear in an inbound AI assistant JSON tree. */
export const PROHIBITED_REQUEST_KEYS = [
  'title',
  'titles',
  'titleKey',
  'sampleTitle',
  'sampleMerchant',
  'merchant',
  'merchantName',
  'description',
  'notes',
  'note',
  'email',
  'userId',
  'userEmail',
  'accountId',
  'accountName',
  'transactionId',
  'transactions',
  'transferGroupId',
  'recurringId',
  'sms',
  'notification',
  'notifications',
  'rawSms',
  'cardNumber',
  'bankAccount',
  'iban',
  'phone',
  'password',
  'accessToken',
  'refreshToken',
  'serviceRole',
] as const;

/**
 * Allowed categorize fields that look like "description" but are explicitly redacted.
 * Nested key `descriptionRedacted` is permitted; bare `description` is not.
 */
export function collectProhibitedPaths(value: unknown, path = '$'): string[] {
  const hits: string[] = [];
  const prohibited = new Set(PROHIBITED_REQUEST_KEYS.map((key) => key.toLowerCase()));

  const walk = (node: unknown, current: string) => {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${current}[${index}]`));
      return;
    }
    if (typeof node === 'object') {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        if (prohibited.has(key.toLowerCase())) {
          hits.push(`${current}.${key}`);
        }
        walk(child, `${current}.${key}`);
      }
    }
  };

  walk(value, path);
  return hits;
}

/** Defence-in-depth: reject labels that still look unredacted (D4). */
export function looksUnredacted(text: string): boolean {
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)) return true;
  if (/https?:\/\//i.test(text)) return true;
  if (/upi:\/\//i.test(text)) return true;
  if (/\b[a-z0-9._-]{2,}@[a-z]{2,}\b/i.test(text)) return true; // UPI VPA-like
  if (/\d{6,}/.test(text.replace(/\s+/g, ''))) return true;
  return false;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
