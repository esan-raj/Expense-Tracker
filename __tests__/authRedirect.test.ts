/// <reference types="jest" />

describe('password reset redirect', () => {
  afterEach(() => {
    jest.resetModules();
    jest.unmock('react-native');
  });

  it('uses the spendwise scheme on native', () => {
    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    const { getPasswordResetRedirectUrl } = require('@/utils/authRedirect');
    expect(getPasswordResetRedirectUrl()).toBe('spendwise://reset-password');
  });

  it('uses the current origin on web', () => {
    jest.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
    (globalThis as { window?: { location: { origin: string } } }).window = {
      location: { origin: 'http://localhost:8081' },
    };
    const { getPasswordResetRedirectUrl, getAuthSiteUrl } = require('@/utils/authRedirect');
    expect(getPasswordResetRedirectUrl()).toBe('http://localhost:8081/reset-password');
    expect(getAuthSiteUrl()).toBe('http://localhost:8081');
  });
});
