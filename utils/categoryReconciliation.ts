export interface FullPullCategoryInput {
  /** Active local categories owned by the signed-in account (signed-out rows excluded). */
  owned: ReadonlyArray<{ id: string; isDefault: boolean }>;
  /** Every category id in the authoritative full pull, tombstones included. */
  remoteIds: ReadonlySet<string>;
  /** Categories with an outbox entry that has not reached Supabase yet. */
  pendingIds: ReadonlySet<string>;
  /** Categories used by an active transaction, recurring rule or budget. */
  referencedIds: ReadonlySet<string>;
}

/**
 * Categories the server no longer has at all after a complete pull. Only valid
 * for full pulls: an incremental response is not a complete dataset.
 * Built-in defaults are never pruned; seedDefaults recreates them on launch and
 * categoryDedupeService merges them with a same-named server copy.
 */
export function findStaleCategoryIds(input: FullPullCategoryInput): string[] {
  return input.owned
    .filter(
      (category) =>
        !category.isDefault &&
        !input.remoteIds.has(category.id) &&
        !input.pendingIds.has(category.id) &&
        !input.referencedIds.has(category.id)
    )
    .map((category) => category.id);
}
