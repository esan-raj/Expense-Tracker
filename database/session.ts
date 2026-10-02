let currentUserId: string | null = null;
let scopedUserId: string | null = null;
/**
 * Advances on every change of signed-in identity, including sign-out, so work started for a
 * session can tell it is stale even after the same account signs in again. Repeated
 * notifications for the account already signed in (token refresh) leave it unchanged.
 */
let sessionGeneration = 0;

/** Only the authentication layer changes the signed-in account. */
export function setCurrentUserId(userId: string | null): void {
  if (userId !== currentUserId) sessionGeneration += 1;
  currentUserId = userId;
  if (userId) {
    scopedUserId = userId;
  }
}

export function getSessionGeneration(): number {
  return sessionGeneration;
}

export function setScopedUserId(userId: string | null): void {
  scopedUserId = userId;
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}

export function getScopedUserId(): string | null {
  return scopedUserId;
}

export function resetSessionForTests(): void {
  currentUserId = null;
  scopedUserId = null;
  sessionGeneration += 1;
}

export function isInScope(
  row: { deletedAt?: string | null; userId?: string | null },
  options: { includeDeleted?: boolean } = {}
): boolean {
  if (!options.includeDeleted && row.deletedAt) return false;
  if (scopedUserId && row.userId && row.userId !== scopedUserId) return false;
  return true;
}

export function scopeClauses(alias?: string): { sql: string; params: string[] } {
  const prefix = alias ? `${alias}.` : '';
  const clauses = [`${prefix}deletedAt IS NULL`];
  const params: string[] = [];
  if (scopedUserId) {
    clauses.push(`(${prefix}userId = ? OR ${prefix}userId IS NULL)`);
    params.push(scopedUserId);
  }
  return { sql: clauses.join(' AND '), params };
}

export function combineWhere(base: string, extraSql: string): string {
  if (!extraSql) return base;
  if (!base.trim()) return `WHERE ${extraSql}`;
  if (base.trim().toUpperCase().startsWith('WHERE')) {
    return `${base} AND ${extraSql}`;
  }
  return `WHERE ${base} AND ${extraSql}`;
}
