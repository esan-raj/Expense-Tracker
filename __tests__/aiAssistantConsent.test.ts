/// <reference types="jest" />

let mockIdCounter = 0;
jest.mock('@/utils/id', () => ({ createId: () => `id-${(mockIdCounter += 1)}` }));

const queueChange = jest.fn(async (..._args: unknown[]): Promise<void> => undefined);
jest.mock('@/services/outbox', () => ({ queueChange: (...args: unknown[]) => queueChange(...args) }));

import { settingsRepository } from '@/database/repositories/settingsRepository';
import { resetDatabaseConnection } from '@/database/database';
import { resetSessionForTests, setCurrentUserId } from '@/database/session';
import { useSettingsStore } from '@/store/useSettingsStore';
import {
  isCloudAiConsentActive,
  readLocalCloudAiConsent,
  requireCloudAiConsentWire,
} from '@/services/aiAssistant/consent';
import { AiClientError } from '@/services/aiAssistant/errors';

describe('cloud AI consent', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockIdCounter = 0;
    resetSessionForTests();
    await resetDatabaseConnection();
    useSettingsStore.setState({
      settings: {
        id: 'default',
        currency: 'INR',
        currencySymbol: '₹',
        theme: 'system',
        accentPreset: 'emerald',
        accentColor: '#0E7C66',
        firstDayOfWeek: 1,
        monthlyBudget: null,
        onboardingComplete: false,
        aiCloudEnabled: false,
        aiConsentPolicyVersion: 0,
        aiConsentAcceptedAt: null,
      },
      loaded: true,
    });
  });

  afterEach(async () => {
    await resetDatabaseConnection();
  });

  it('defaults to disabled', async () => {
    const local = await readLocalCloudAiConsent();
    expect(local.enabled).toBe(false);
    expect(isCloudAiConsentActive(local)).toBe(false);
    await expect(requireCloudAiConsentWire()).rejects.toMatchObject({ kind: 'opt_in_required' });
  });

  it('explicit enable writes policy version 1 without outbox', async () => {
    setCurrentUserId('user-1');
    await useSettingsStore.getState().setCloudAiConsent(true);
    const local = await readLocalCloudAiConsent();
    expect(local.enabled).toBe(true);
    expect(local.policyVersion).toBe(1);
    expect(local.acceptedAt).toBeTruthy();
    expect(queueChange).not.toHaveBeenCalled();
    await expect(requireCloudAiConsentWire()).resolves.toEqual({ cloudAi: true, policyVersion: 1 });
  });

  it('immediate disable clears consent for future requests', async () => {
    await useSettingsStore.getState().setCloudAiConsent(true);
    await useSettingsStore.getState().setCloudAiConsent(false);
    const local = await readLocalCloudAiConsent();
    expect(local.enabled).toBe(false);
    expect(local.policyVersion).toBe(0);
    expect(local.acceptedAt).toBeNull();
    await expect(requireCloudAiConsentWire()).rejects.toBeInstanceOf(AiClientError);
  });

  it('unsupported policy version is rejected', async () => {
    await settingsRepository.update({
      aiCloudEnabled: true,
      aiConsentPolicyVersion: 99,
      aiConsentAcceptedAt: '2026-10-18T00:00:00.000Z',
    });
    await expect(requireCloudAiConsentWire()).rejects.toMatchObject({ kind: 'unsupported_policy' });
  });

  it('consent can be configured offline (no network dependency)', async () => {
    await useSettingsStore.getState().setCloudAiConsent(true);
    const settings = await settingsRepository.get();
    expect(settings.aiCloudEnabled).toBe(true);
  });

  it('profile sync-style updates do not clear or auto-enable consent incorrectly', async () => {
    await useSettingsStore.getState().setCloudAiConsent(true);
    await settingsRepository.update({
      currency: 'USD',
      currencySymbol: '$',
      theme: 'dark',
      firstDayOfWeek: 0,
      monthlyBudget: 1,
      onboardingComplete: true,
    });
    expect((await settingsRepository.get()).aiCloudEnabled).toBe(true);
    await useSettingsStore.getState().setCloudAiConsent(false);
    expect((await settingsRepository.get()).aiCloudEnabled).toBe(false);
  });

  it('synced profile queueChange never includes AI consent fields', async () => {
    setCurrentUserId('user-1');
    await useSettingsStore.getState().setCloudAiConsent(true);
    queueChange.mockClear();
    await useSettingsStore.getState().setTheme('dark');
    expect(queueChange).toHaveBeenCalledTimes(1);
    const payload = queueChange.mock.calls[0][3] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('aiCloudEnabled');
    expect(payload).not.toHaveProperty('aiConsentPolicyVersion');
    expect(payload).not.toHaveProperty('aiConsentAcceptedAt');
  });
});
