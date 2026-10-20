/**
 * Deterministic PII redaction for short financial free-text (titles / optional descriptions).
 *
 * Regex-based redaction reduces risk but cannot guarantee removal of every possible identifier.
 * If residual prohibited patterns remain after redaction, the field is rejected (omitted).
 *
 * Never log the original or redacted free text.
 */

const utf8 = new TextEncoder();

export type RedactFailureReason = 'empty' | 'unsafe' | 'too_long';

export type RedactResult =
  | { ok: true; text: string }
  | { ok: false; reason: RedactFailureReason };

export type RedactOptions = {
  /** Max UTF-8 bytes after redaction (default 240). */
  maxUtf8Bytes?: number;
  /** Max JS string length after redaction (default 80 — Edge merchant/description). */
  maxChars?: number;
};

const ZERO_WIDTH =
  /[\u200B-\u200D\uFEFF\u2060\u180E\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u3164\uFFA0]/g;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Ordered replacement rules — applied left-to-right, deterministically. */
const RULES: Array<{ marker: string; pattern: RegExp }> = [
  {
    marker: '[REDACTED_JWT]',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    marker: '[REDACTED_SECRET]',
    pattern:
      /\b(?:token|password|passwd|pwd|api[_-]?key|secret|authorization)\s*[=:]\s*['"]?[^\s'"]{4,}/gi,
  },
  {
    marker: '[REDACTED_TOKEN]',
    pattern: /\b(?:bearer\s+)[A-Za-z0-9._\-+=/]{8,}/gi,
  },
  {
    marker: '[REDACTED_URL]',
    pattern: /\bhttps?:\/\/[^\s]+/gi,
  },
  {
    marker: '[REDACTED_EMAIL]',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    // UPI VPA — after email so email@domain.com is not treated as UPI.
    marker: '[REDACTED_UPI]',
    pattern: /\b[a-zA-Z0-9._-]{2,}@[a-zA-Z][a-zA-Z0-9._-]{1,}\b/g,
  },
  {
    // 12–19 digit card/account-like runs before phone (10) so cards are not phone-sliced.
    marker: '[REDACTED_ACCOUNT]',
    pattern: /(?:\d[\s-]*){12,19}/g,
  },
  {
    marker: '[REDACTED_PHONE]',
    pattern: /(?:\+?\s*91[\s-]*)?(?:\b0)?(?:[\s-]?\d){10}\b/g,
  },
  {
    marker: '[REDACTED_OTP]',
    pattern: /\b\d{4,8}\b/g,
  },
  {
    // Remaining long digit runs (6+).
    marker: '[REDACTED_DIGITS]',
    pattern: /(?:\d[\s-]*){6,}/g,
  },
];

function normalizeInput(raw: string): string {
  return raw
    .replace(ZERO_WIDTH, '')
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyRules(text: string): string {
  let out = text;
  for (const rule of RULES) {
    // Reset lastIndex for global patterns.
    rule.pattern.lastIndex = 0;
    out = out.replace(rule.pattern, rule.marker);
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Residual patterns that must not remain (aligned with Edge looksUnredacted + extras).
 * Does not treat [REDACTED_*] markers as leaks.
 */
export function hasProhibitedResidual(text: string): boolean {
  const withoutMarkers = text.replace(/\[REDACTED_[A-Z_]+]/g, ' ');
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(withoutMarkers)) return true;
  if (/https?:\/\//i.test(withoutMarkers)) return true;
  if (/upi:\/\//i.test(withoutMarkers)) return true;
  if (/\b[a-z0-9._-]{2,}@[a-z]{2,}\b/i.test(withoutMarkers)) return true;
  if (/\d{6,}/.test(withoutMarkers.replace(/[\s-]/g, ''))) return true;
  if (/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/i.test(withoutMarkers)) return true;
  if (/\bbearer\s+[A-Za-z0-9._\-+=/]{8,}/i.test(withoutMarkers)) return true;
  if (/\b(?:token|password|api[_-]?key)\s*[=:]/i.test(withoutMarkers)) return true;
  return false;
}

export function utf8ByteLength(value: string): number {
  return utf8.encode(value).length;
}

/**
 * Redact untrusted free text for AI-safe envelopes.
 * Idempotent: already-redacted markers are left intact; re-running yields the same result.
 */
export function redactFinancialText(input: unknown, options: RedactOptions = {}): RedactResult {
  const maxUtf8Bytes = options.maxUtf8Bytes ?? 240;
  const maxChars = options.maxChars ?? 80;

  if (typeof input !== 'string') {
    return { ok: false, reason: 'empty' };
  }

  const normalized = normalizeInput(input);
  if (!normalized) {
    return { ok: false, reason: 'empty' };
  }

  const redacted = applyRules(normalized);
  if (!redacted) {
    return { ok: false, reason: 'empty' };
  }

  if (hasProhibitedResidual(redacted)) {
    return { ok: false, reason: 'unsafe' };
  }

  if (redacted.length > maxChars || utf8ByteLength(redacted) > maxUtf8Bytes) {
    return { ok: false, reason: 'too_long' };
  }

  return { ok: true, text: redacted };
}
