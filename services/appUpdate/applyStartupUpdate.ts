import * as Updates from 'expo-updates';

const DEFAULT_TIMEOUT_MS = 6_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Best-effort OTA apply before the local DB gate.
 * Required because app.json uses checkAutomatically: NEVER and update
 * checks previously only ran after startup.phase === 'ready' — so a stuck
 * loading screen could never receive newer JS bundles.
 */
export async function applyStartupUpdateIfAvailable(
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<'reloading' | 'skipped'> {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return 'skipped';
  if (!Updates.isEnabled) return 'skipped';

  try {
    const check = await Promise.race([
      Updates.checkForUpdateAsync(),
      delay(timeoutMs).then(() => null),
    ]);
    if (!check?.isAvailable) return 'skipped';

    const fetched = await Promise.race([
      Updates.fetchUpdateAsync(),
      delay(timeoutMs).then(() => null),
    ]);
    if (!fetched?.isNew && !fetched?.isRollBackToEmbedded) return 'skipped';

    await Updates.reloadAsync();
    return 'reloading';
  } catch {
    return 'skipped';
  }
}
