type SyncKind = 'pull' | 'full';
type FollowUp = 'none' | SyncKind;

export function createSyncGate() {
  let inFlight: Promise<void> | null = null;
  let followUp: FollowUp = 'none';

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
        if (kind === 'pull') upgrade('pull');
        return inFlight;
      }
      inFlight = (async () => {
        let next: FollowUp = kind;
        try {
          while (next !== 'none') {
            const current = next;
            followUp = 'none';
            await execute(current);
            next = followUp;
          }
        } finally {
          inFlight = null;
          followUp = 'none';
        }
      })();
      return inFlight;
    },
    reset() {
      inFlight = null;
      followUp = 'none';
    },
  };
}

export const syncGate = createSyncGate();
