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
  /** Replace only this account's rows (plus unassigned ones) and store the new rows under it. */
  ownerId?: string;
}

/** Rows a full replacement removes: every row (backup restore) or one account's rows. */
export function replacementQuery(options: ReplaceOptions = {}): { selector: Record<string, unknown> } {
  return options.ownerId ? { selector: { userId: { $in: [options.ownerId, ''] } } } : { selector: {} };
}

export function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}
