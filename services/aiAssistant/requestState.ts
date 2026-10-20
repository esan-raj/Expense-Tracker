import type { AiClientErrorKind } from './errors';

/**
 * Minimal presentation states for future AI screens.
 * No automatic transitions — callers drive prepare → request explicitly.
 */
export type AiRequestStatus =
  | 'idle'
  | 'preparing'
  | 'requesting'
  | 'success'
  | 'unavailable'
  | 'error'
  | 'cancelled';

export type AiRequestState<T = unknown> = {
  status: AiRequestStatus;
  result: T | null;
  errorKind: AiClientErrorKind | null;
  /** Safe, non-sensitive message for UI. */
  message: string | null;
};

export function idleAiRequestState<T = unknown>(): AiRequestState<T> {
  return { status: 'idle', result: null, errorKind: null, message: null };
}

export function reduceAiRequestState<T>(
  current: AiRequestState<T>,
  event:
    | { type: 'prepare' }
    | { type: 'request' }
    | { type: 'success'; result: T }
    | { type: 'unavailable'; message?: string }
    | { type: 'error'; kind: AiClientErrorKind; message: string }
    | { type: 'cancel' }
    | { type: 'reset' }
): AiRequestState<T> {
  switch (event.type) {
    case 'reset':
      return idleAiRequestState();
    case 'prepare':
      return { status: 'preparing', result: null, errorKind: null, message: null };
    case 'request':
      return { status: 'requesting', result: null, errorKind: null, message: null };
    case 'success':
      return { status: 'success', result: event.result, errorKind: null, message: null };
    case 'unavailable':
      return {
        status: 'unavailable',
        result: null,
        errorKind: 'unavailable',
        message: event.message ?? 'AI assistant is unavailable',
      };
    case 'error':
      return {
        status: 'error',
        result: null,
        errorKind: event.kind,
        message: event.message,
      };
    case 'cancel':
      return { status: 'cancelled', result: null, errorKind: 'cancelled', message: 'Cancelled' };
    default:
      return current;
  }
}
