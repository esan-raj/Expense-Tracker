/**
 * Privacy / Settings disclosure for cloud AI (Phase 4A).
 * Plain language — does not imply a provider is currently available.
 */

export const CLOUD_AI_PRIVACY_TITLE = 'Cloud AI assistance';

export const CLOUD_AI_PRIVACY_DISCLOSURE = [
  'When enabled, SpendWise may send selected redacted financial summaries from this device to a cloud AI service for optional explanations and suggestions.',
  'Raw SMS or notification content, account numbers, UPI IDs, card numbers, email addresses, your user ID, auth tokens, notes, and your full transaction history are not sent.',
  'AI suggestions may be inaccurate. Budget changes are never applied without your confirmation.',
  'You can turn this off at any time. Disabling stops future cloud AI requests from this device.',
  'Turning the setting on does not mean an AI provider is available yet. No request runs automatically.',
].join('\n\n');

export const CLOUD_AI_ENABLE_CONFIRM_TITLE = 'Enable cloud AI?';

export const CLOUD_AI_ENABLE_CONFIRM_MESSAGE =
  'Selected redacted financial summaries will be allowed to leave this device for cloud AI processing. Sensitive identifiers and full history stay off the wire. Continue?';

export const CLOUD_AI_SWITCH_ACCESSIBILITY_LABEL = 'Cloud AI assistance';

export const CLOUD_AI_SWITCH_ACCESSIBILITY_HINT =
  'When on, allows redacted financial summaries to be sent for optional AI assistance. Off by default.';

export type CloudAiConsentUiEvent =
  | { type: 'toggle_on' }
  | { type: 'confirm_enable' }
  | { type: 'cancel_enable' }
  | { type: 'toggle_off' };

export type CloudAiConsentUiState = {
  enabled: boolean;
  confirmVisible: boolean;
};

/** Pure confirmation flow for Privacy screen (testable without RN renderers). */
export function reduceCloudAiConsentUi(
  state: CloudAiConsentUiState,
  event: CloudAiConsentUiEvent
): CloudAiConsentUiState {
  switch (event.type) {
    case 'toggle_on':
      if (state.enabled) return state;
      return { ...state, confirmVisible: true };
    case 'confirm_enable':
      return { enabled: true, confirmVisible: false };
    case 'cancel_enable':
      return { ...state, confirmVisible: false };
    case 'toggle_off':
      return { enabled: false, confirmVisible: false };
    default:
      return state;
  }
}
