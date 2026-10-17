import { parseTimestampMs } from '@/utils/syncLogic';

export interface GeneratedLocalCopy {
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedServerCopy {
  updatedAt: string;
  deletedAt: string | null;
}

export type GeneratedOccurrenceDecision = 'deleted_remotely' | 'keep_remote' | 'update_remote';

/**
 * A generated recurring occurrence has a deterministic id, so another device (or an earlier
 * attempt whose response was lost) may already have stored it. Decides which copy wins:
 *
 * - A server tombstone always wins; a deleted occurrence is never resurrected.
 * - A local copy that was never edited (updatedAt == createdAt) never overwrites the server.
 * - A local edit wins only when it is strictly newer than the server copy.
 * - Equal timestamps keep the server copy, so retrying an upload the server already
 *   accepted converges instead of writing again.
 * - Unreadable timestamps keep the server copy rather than guessing.
 */
export function decideGeneratedOccurrence(
  local: GeneratedLocalCopy,
  server: GeneratedServerCopy
): GeneratedOccurrenceDecision {
  if (server.deletedAt) return 'deleted_remotely';
  const createdMs = parseTimestampMs(local.createdAt);
  const localMs = parseTimestampMs(local.updatedAt);
  const serverMs = parseTimestampMs(server.updatedAt);
  if (!Number.isFinite(createdMs) || !Number.isFinite(localMs) || !Number.isFinite(serverMs)) return 'keep_remote';
  if (localMs <= createdMs) return 'keep_remote';
  return localMs > serverMs ? 'update_remote' : 'keep_remote';
}
