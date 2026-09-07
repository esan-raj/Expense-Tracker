let currentUserId: string | null = null;
let scopedUserId: string | null = null;

export function setCurrentUserId(userId: string | null): void {
  currentUserId = userId;
  if (userId) {
    scopedUserId = userId;
  }
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
