/**
 * RxDB settings schema migrations.
 * Cloud AI consent fields always default to disabled — never auto-enable.
 */

export type SettingsDocLike = Record<string, unknown>;

/** v0/v1 → v2: add device-local AI consent fields (always off). */
export function migrateSettingsToV2(doc: SettingsDocLike): SettingsDocLike {
  return {
    ...doc,
    aiCloudEnabled: false,
    aiConsentPolicyVersion: 0,
    aiConsentAcceptedAt: '',
  };
}
