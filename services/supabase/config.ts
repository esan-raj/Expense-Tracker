function readUrl(): string {
  return (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
}

function readAnonKey(): string {
  return (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
}

function isLocalhostUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return /localhost|127\.0\.0\.1|\[::1\]/i.test(url);
  }
}

export function getSupabasePublicEnv(): { url: string; anonKey: string } {
  return { url: readUrl(), anonKey: readAnonKey() };
}

export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = getSupabasePublicEnv();
  return Boolean(url && anonKey && url.startsWith('https://') && !isLocalhostUrl(url));
}

export function logSupabaseConfig(): void {
  const { url, anonKey } = getSupabasePublicEnv();
  console.info('[supabase][config] URL configured:', Boolean(url && url.startsWith('https://') && !isLocalhostUrl(url)));
  console.info('[supabase][config] anon key configured:', Boolean(anonKey));
}
