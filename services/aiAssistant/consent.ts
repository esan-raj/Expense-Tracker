import { settingsRepository } from '@/database/repositories/settingsRepository';
import { CLOUD_AI_CONSENT_POLICY_VERSION } from './constants';
import { AiClientError } from './errors';

export type CloudAiConsentWire = {
  cloudAi: true;
  policyVersion: 1;
};

export type LocalCloudAiConsent = {
  enabled: boolean;
  policyVersion: number;
  acceptedAt: string | null;
};

export async function readLocalCloudAiConsent(): Promise<LocalCloudAiConsent> {
  const settings = await settingsRepository.get();
  return {
    enabled: Boolean(settings.aiCloudEnabled),
    policyVersion: settings.aiConsentPolicyVersion ?? 0,
    acceptedAt: settings.aiConsentAcceptedAt ?? null,
  };
}

/**
 * Returns the Edge consent contract when local opt-in is active for policy v1.
 * Throws typed client errors otherwise — never invents consent.
 */
export async function requireCloudAiConsentWire(): Promise<CloudAiConsentWire> {
  const local = await readLocalCloudAiConsent();
  if (!local.enabled) {
    throw new AiClientError('opt_in_required', 'Cloud AI is disabled', { retryable: false });
  }
  if (local.policyVersion !== CLOUD_AI_CONSENT_POLICY_VERSION) {
    throw new AiClientError(
      'unsupported_policy',
      'Cloud AI consent policy must be re-accepted',
      { retryable: false }
    );
  }
  return { cloudAi: true, policyVersion: 1 };
}

export function isCloudAiConsentActive(local: LocalCloudAiConsent): boolean {
  return local.enabled && local.policyVersion === CLOUD_AI_CONSENT_POLICY_VERSION;
}
