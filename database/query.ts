import { getCurrentUserId, getScopedUserId } from '@/database/session';

export function ownerId(userId?: string | null): string {
  return userId ?? getCurrentUserId() ?? '';
}

export function emptyToNull(value: string | null | undefined): string | null {
  return value ? value : null;
}

export function nullToEmpty(value: string | null | undefined): string {
  return value ?? '';
}

export function scopeSelector(includeDeleted = false): Record<string, unknown> {
  const scoped = getScopedUserId();
  const selector: Record<string, unknown> = includeDeleted ? {} : { deletedAt: '' };
  if (scoped) {
    selector.userId = { $in: [scoped, ''] };
  }
  return selector;
}

export interface ReplaceOptions {
  /** Replace only rows owned by this account and store the new rows under it. */
  ownerId?: string;
}

/**
 * Rows a full replacement removes: every row (backup restore) or one account's rows.
 * Unassigned rows (userId '') are never part of an account's replacement: they are signed-out
 * work that has not been claimed yet.
 */
export function replacementQuery(options: ReplaceOptions = {}): { selector: Record<string, unknown> } {
  return options.ownerId ? { selector: { userId: options.ownerId } } : { selector: {} };
}

export function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}
