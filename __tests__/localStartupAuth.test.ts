/// <reference types="jest" />
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  authStorageKey,
  getPersistedAuthSession,
  parseStoredSession,
} from '@/services/authLocalSession';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('@/services/supabase/config', () => ({
  getSupabasePublicEnv: () => ({
    url: 'https://abcxyz.supabase.co',
    anonKey: 'test-anon-key',
  }),
  isSupabaseConfigured: () => true,
}));

describe('local-first auth session', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds the expected AsyncStorage key from the project URL', () => {
    expect(authStorageKey('https://abcxyz.supabase.co')).toBe('sb-abcxyz-auth-token');
  });

  it('parses a raw session blob', () => {
    const session = parseStoredSession(
      JSON.stringify({
        access_token: 'tok',
        user: { id: 'user-1' },
      })
    );
    expect(session?.user?.id).toBe('user-1');
  });

  it('reads a persisted session from AsyncStorage without network APIs', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({
        access_token: 'tok',
        user: { id: 'user-1', email: 'a@b.c' },
      })
    );

    const restored = await getPersistedAuthSession();
    expect(restored?.user?.id).toBe('user-1');
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('sb-abcxyz-auth-token');
  });

  it('returns null when storage is empty', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    await expect(getPersistedAuthSession()).resolves.toBeNull();
  });
});
