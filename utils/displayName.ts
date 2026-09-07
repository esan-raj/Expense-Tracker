export function displayFirstName(user?: { email?: string | null; user_metadata?: Record<string, unknown> } | null): string {
  const meta = user?.user_metadata ?? {};
  const raw =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    (typeof meta.display_name === 'string' && meta.display_name) ||
    '';
  const fromMeta = raw.trim().split(/\s+/)[0];
  if (fromMeta) return capitalize(fromMeta);

  const local = (user?.email ?? '').split('@')[0]?.replace(/[._-]+/g, ' ').trim() ?? '';
  const fromEmail = local.split(/\s+/)[0];
  return fromEmail ? capitalize(fromEmail) : '';
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
