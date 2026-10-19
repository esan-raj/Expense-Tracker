import type { AiAssistantErrorCode, AiAssistantFailure } from './types.ts';

export class FinancialAssistantError extends Error {
  readonly code: AiAssistantErrorCode;
  readonly httpStatus: number;

  constructor(code: AiAssistantErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = 'FinancialAssistantError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function errorResponse(requestId: string, code: AiAssistantErrorCode, message: string): AiAssistantFailure {
  return {
    schemaVersion: 1,
    requestId,
    error: { code, message },
  };
}

export function httpStatusFor(code: AiAssistantErrorCode): number {
  switch (code) {
    case 'auth':
      return 401;
    case 'origin_not_allowed':
      return 403;
    case 'rate_limit':
      return 429;
    case 'invalid_request':
    case 'stale_snapshot':
    case 'opt_in_required':
      return 400;
    case 'invalid_model_output':
      return 502;
    case 'timeout':
      return 504;
    case 'provider_unavailable':
    case 'offline':
      return 503;
    default:
      return 500;
  }
}
