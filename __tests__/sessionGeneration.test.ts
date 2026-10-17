/// <reference types="jest" />
import { getCurrentUserId, getSessionGeneration, resetSessionForTests, setCurrentUserId } from '@/database/session';
import {
  assertSyncSession,
  captureSyncContext,
  isSyncSessionActive,
  SyncSessionChangedError,
} from '@/services/syncSession';

describe('session generation', () => {
  beforeEach(() => {
    resetSessionForTests();
  });

  it('captures nothing while signed out', () => {
    expect(captureSyncContext()).toBeNull();
  });

  it('keeps a context valid across repeated notifications for the same account (token refresh)', () => {
    setCurrentUserId('user-a');
    const context = captureSyncContext()!;
    setCurrentUserId('user-a');
    setCurrentUserId('user-a');
    expect(isSyncSessionActive(context)).toBe(true);
    expect(() => assertSyncSession(context)).not.toThrow();
  });

  it('invalidates a context when another account signs in', () => {
    setCurrentUserId('user-a');
    const context = captureSyncContext()!;
    setCurrentUserId('user-b');
    expect(() => assertSyncSession(context)).toThrow(SyncSessionChangedError);
  });

  it('invalidates a context after switching away and back to the same account', () => {
    setCurrentUserId('user-a');
    const context = captureSyncContext()!;
    setCurrentUserId('user-b');
    setCurrentUserId('user-a');
    expect(getCurrentUserId()).toBe('user-a');
    expect(isSyncSessionActive(context)).toBe(false);
  });

  it('invalidates a context after signing out and back in to the same account', () => {
    setCurrentUserId('user-a');
    const context = captureSyncContext()!;
    setCurrentUserId(null);
    setCurrentUserId('user-a');
    expect(isSyncSessionActive(context)).toBe(false);
    expect(captureSyncContext()).toEqual({ userId: 'user-a', generation: getSessionGeneration() });
  });

  it('only advances the generation on a real identity change', () => {
    const start = getSessionGeneration();
    setCurrentUserId(null);
    expect(getSessionGeneration()).toBe(start);
    setCurrentUserId('user-a');
    setCurrentUserId('user-a');
    expect(getSessionGeneration()).toBe(start + 1);
    setCurrentUserId(null);
    expect(getSessionGeneration()).toBe(start + 2);
  });

  it('invalidates contexts captured before a test reset', () => {
    setCurrentUserId('user-a');
    const context = captureSyncContext()!;
    resetSessionForTests();
    setCurrentUserId('user-a');
    expect(isSyncSessionActive(context)).toBe(false);
  });
});
