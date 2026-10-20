/// <reference types="jest" />
import {
  CLOUD_AI_ENABLE_CONFIRM_MESSAGE,
  CLOUD_AI_ENABLE_CONFIRM_TITLE,
  CLOUD_AI_PRIVACY_DISCLOSURE,
  CLOUD_AI_PRIVACY_TITLE,
  CLOUD_AI_SWITCH_ACCESSIBILITY_HINT,
  CLOUD_AI_SWITCH_ACCESSIBILITY_LABEL,
  reduceCloudAiConsentUi,
} from '@/services/aiAssistant/privacyCopy';
import { idleAiRequestState, reduceAiRequestState } from '@/services/aiAssistant/requestState';

describe('cloud AI privacy UI boundary', () => {
  it('requires confirmation before enable', () => {
    let state = { enabled: false, confirmVisible: false };
    state = reduceCloudAiConsentUi(state, { type: 'toggle_on' });
    expect(state).toEqual({ enabled: false, confirmVisible: true });
    state = reduceCloudAiConsentUi(state, { type: 'confirm_enable' });
    expect(state).toEqual({ enabled: true, confirmVisible: false });
  });

  it('disable takes effect without second confirmation', () => {
    let state = { enabled: true, confirmVisible: false };
    state = reduceCloudAiConsentUi(state, { type: 'toggle_off' });
    expect(state).toEqual({ enabled: false, confirmVisible: false });
  });

  it('cancel leaves consent disabled', () => {
    let state = { enabled: false, confirmVisible: false };
    state = reduceCloudAiConsentUi(state, { type: 'toggle_on' });
    state = reduceCloudAiConsentUi(state, { type: 'cancel_enable' });
    expect(state).toEqual({ enabled: false, confirmVisible: false });
  });

  it('disclosure explains redaction, inaccuracy, confirmation, and revocation', () => {
    const text = `${CLOUD_AI_PRIVACY_TITLE}\n${CLOUD_AI_PRIVACY_DISCLOSURE}\n${CLOUD_AI_ENABLE_CONFIRM_MESSAGE}`;
    expect(text.toLowerCase()).toContain('redacted');
    expect(text.toLowerCase()).toContain('not sent');
    expect(text.toLowerCase()).toContain('inaccurate');
    expect(text.toLowerCase()).toContain('confirmation');
    expect(text.toLowerCase()).toContain('disabling');
    expect(text.toLowerCase()).toContain('not mean an ai provider is available');
    expect(CLOUD_AI_ENABLE_CONFIRM_TITLE.length).toBeGreaterThan(0);
  });

  it('exposes accessible switch labels', () => {
    expect(CLOUD_AI_SWITCH_ACCESSIBILITY_LABEL.length).toBeGreaterThan(0);
    expect(CLOUD_AI_SWITCH_ACCESSIBILITY_HINT.length).toBeGreaterThan(0);
  });

  it('request state machine covers idle → preparing → requesting → terminal states', () => {
    let state = idleAiRequestState();
    state = reduceAiRequestState(state, { type: 'prepare' });
    expect(state.status).toBe('preparing');
    state = reduceAiRequestState(state, { type: 'request' });
    expect(state.status).toBe('requesting');
    state = reduceAiRequestState(state, { type: 'unavailable' });
    expect(state.status).toBe('unavailable');
    state = reduceAiRequestState(state, { type: 'reset' });
    state = reduceAiRequestState(state, { type: 'cancel' });
    expect(state.status).toBe('cancelled');
  });
});
