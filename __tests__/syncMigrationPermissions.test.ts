/// <reference types="jest" />

const fs = require('fs') as { readFileSync: (path: string, encoding: string) => string };
const path = require('path') as { join: (...parts: string[]) => string };

const dir = path.join(process.cwd(), 'supabase', 'migrations');
const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf8');
const statements = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .toLowerCase()
    .replace(/\s+/g, ' ');

describe('sync_server_time permissions', () => {
  const m008 = statements(read('008_server_sync_cursor.sql'));
  const m009 = statements(read('009_harden_sync_server_time_permissions.sql'));

  it('008 defines the zero-argument function that 009 targets', () => {
    expect(m008).toContain('create or replace function public.sync_server_time() returns timestamptz');
  });

  it('009 revokes PUBLIC and anon and keeps authenticated, with the exact signature', () => {
    expect(m009).toContain('revoke execute on function public.sync_server_time() from public;');
    expect(m009).toContain('revoke execute on function public.sync_server_time() from anon;');
    expect(m009).toContain('grant execute on function public.sync_server_time() to authenticated;');
  });

  it('009 makes no destructive or RLS changes', () => {
    expect(m009).not.toMatch(/\b(drop|alter|truncate|delete|disable row level security|create policy)\b/);
  });
});
