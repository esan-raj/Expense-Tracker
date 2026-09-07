/// <reference types="jest" />
import {
  getCurrentUserId,
  getScopedUserId,
  isInScope,
  resetSessionForTests,
  scopeClauses,
  setCurrentUserId,
  setScopedUserId,
} from '@/database/session';

describe('local user isolation', () => {
  afterEach(() => {
    resetSessionForTests();
  });

  it('does not queue against a logged-out user', () => {
    setCurrentUserId('user-a');
    expect(getCurrentUserId()).toBe('user-a');
    setCurrentUserId(null);
    expect(getCurrentUserId()).toBeNull();
    expect(getScopedUserId()).toBe('user-a');
  });

  it('keeps the last account scoped after logout', () => {
    setCurrentUserId('user-a');
    setCurrentUserId(null);
    const scope = scopeClauses();
    expect(scope.sql).toContain('userId = ?');
    expect(scope.params).toEqual(['user-a']);
  });

  it('switches scope when another account signs in', () => {
    setCurrentUserId('user-a');
    setCurrentUserId('user-b');
    expect(getCurrentUserId()).toBe('user-b');
    expect(scopeClauses().params).toEqual(['user-b']);
  });

  it('can restore a scoped user from persisted sync state', () => {
    setScopedUserId('user-a');
    expect(getCurrentUserId()).toBeNull();
    expect(scopeClauses().params).toEqual(['user-a']);
    expect(isInScope({ userId: 'user-a' })).toBe(true);
    expect(isInScope({ userId: 'user-b' })).toBe(false);
  });
});
