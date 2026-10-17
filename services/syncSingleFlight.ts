import { getCurrentUserId } from '@/database/session';

type SyncKind = 'pull' | 'full';
type FollowUp = 'none' | SyncKind;

/**
 * One sync pipeline at a time. `currentOwner` is the signed-in account: a request from the
 * account already syncing joins the in-flight run (a pull during a full sync queues one more
 * pull), while a request from a different signed-in account queues one full sync for it
 * instead of being absorbed by the old account's run.
 */
export function createSyncGate(currentOwner: () => string | null = () => null) {
  let inFlight: Promise<void> | null = null;
  let followUp: FollowUp = 'none';
  let runningOwner: string | null = null;

  function upgrade(kind: SyncKind) {
    if (kind === 'full') followUp = 'full';
    else if (followUp === 'none') followUp = 'pull';
  }

  return {
    isRunning(): boolean {
      return inFlight !== null;
    },
    requestFollowUp(kind: SyncKind = 'full') {
      if (inFlight) upgrade(kind);
    },
    run(kind: SyncKind, execute: (kind: SyncKind) => Promise<void>): Promise<void> {
      if (inFlight) {
        const owner = currentOwner();
        if (owner && owner !== runningOwner) upgrade('full');
        else if (kind === 'pull') upgrade('pull');
        return inFlight;
      }
      inFlight = (async () => {
        let next: FollowUp = kind;
        try {
          while (next !== 'none') {
            const current = next;
            followUp = 'none';
            runningOwner = currentOwner();
            await execute(current);
            next = followUp;
          }
        } finally {
          inFlight = null;
          followUp = 'none';
          runningOwner = null;
        }
      })();
      return inFlight;
    },
    reset() {
      inFlight = null;
      followUp = 'none';
      runningOwner = null;
    },
  };
}

export const syncGate = createSyncGate(getCurrentUserId);
