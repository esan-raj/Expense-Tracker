/// <reference types="jest" />

const { readdirSync, readFileSync } = require('fs') as {
  readFileSync: (path: string, encoding: string) => string;
  readdirSync: (path: string) => string[];
};
const { join } = require('path') as { join: (...parts: string[]) => string };
const { createHash } = require('crypto') as {
  createHash: (algorithm: string) => { update: (data: string) => { digest: (encoding: string) => string } };
};

interface ExecResult {
  code: number | null;
  signal?: string | null;
  stdout: string;
  stderr: string;
  error?: string;
  started?: boolean;
}
interface ExecCall {
  file: string;
  args: string[];
  opts: { cwd: string; env: Record<string, string | undefined>; timeoutMs: number };
}
interface Parsed {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  projectRef: string | null;
  kind: string;
  raw: string;
}
interface Runner {
  EXIT: { ok: number; failed: number; usage: number; unknown: number };
  PUBLISHED: Record<string, { name: string; sha256: string }>;
  SUPABASE_CLI_VERSION: string;
  run(argv: string[], deps: object): Promise<number>;
  parseArgs(argv: string[]): { mode: string; envFile: string | null; confirmProjectRef: string | null; verbose: boolean };
  resolveDatabaseUrl(env: Record<string, string | undefined>): { variable: string; url: string; ignored: string[] };
  parseDatabaseUrl(raw: string): Parsed;
  describeTarget(parsed: Parsed): string;
  createRedactor(secrets: string[]): (text: string) => string;
  readEnvFile(file: string, env: Record<string, string | undefined>, readFile: () => string): Record<string, string>;
  parseMigrationList(text: string): Array<{ local: string | null; remote: string | null }>;
  parseDryRun(text: string): string[];
  planMigrations(local: string[], rows: Array<{ local: string | null; remote: string | null }>): {
    applied: string[];
    pending: string[];
    problems: string[];
  };
  migrationProblems(files: Array<{ name: string; content: string }>): string[];
  resolveCli(env: Record<string, string | undefined>, deps: object): { file: string; prefix: string[] };
  buildCliCall(cli: { file: string; prefix: string[] }, parsed: Parsed, args: string[], env: object): {
    file: string;
    args: string[];
    env: Record<string, string | undefined>;
  };
}

const runner = require('../scripts/apply-supabase-migrations') as Runner;
const { EXIT } = runner;

const REF = 'abcdefghijklmnopqrst';
const OTHER_REF = 'zyxwvutsrqponmlkjihg';
const PASSWORD = 'S3cr3t-p@ss/word#1';
const DB_URL = `postgresql://postgres:${encodeURIComponent(PASSWORD)}@db.${REF}.supabase.co:5432/postgres`;
const POOLER_URL = `postgresql://postgres.${REF}:${encodeURIComponent(PASSWORD)}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`;
const ROOT = 'C:\\Users\\Esan Raj\\My Projects\\Expense Tracker';
const NODE = 'C:\\Program Files\\nodejs\\node.exe';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const REAL_FILES = new Map(readdirSync(migrationsDir).map((name) => [name, readFileSync(join(migrationsDir, name), 'utf8')]));
const REAL_VERSIONS = [...REAL_FILES.keys()].map((name) => name.slice(0, 3)).sort();
const versionAfter = (count: number) => String(REAL_VERSIONS.length + count).padStart(3, '0');

function historyTable(local: string[], remote: string[]): string {
  const versions = [...new Set([...local, ...remote])].sort();
  return [
    '',
    '   Local | Remote | Time (UTC)',
    '  -------|--------|------------',
    ...versions.map((v) => `   ${local.includes(v) ? v : '   '}   | ${remote.includes(v) ? v : '   '}    | ${v}`),
    '',
  ].join('\n');
}

interface Scenario {
  files?: Map<string, string>;
  env?: Record<string, string | undefined>;
  gitStatus?: string;
  gitStatusCode?: number;
  envFileIgnored?: boolean;
  envFileText?: string;
  linkedRef?: string;
  remote?: string[];
  /** Remote history after a push; defaults to everything local. */
  remoteAfterPush?: string[];
  list?: ExecResult;
  dryRun?: ExecResult;
  push?: ExecResult;
  /** Echo the connection string and password from the "CLI" to prove redaction. */
  leakyCli?: boolean;
}

function harness(scenario: Scenario = {}) {
  const files = scenario.files ?? REAL_FILES;
  const calls: ExecCall[] = [];
  let pushed = false;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const leak = scenario.leakyCli ? `\nconnecting to ${DB_URL} with password ${PASSWORD}\n` : '';
  const local = [...files.keys()].map((name) => name.slice(0, 3)).sort();
  const exec = jest.fn(async (file: string, args: string[], opts: ExecCall['opts']): Promise<ExecResult> => {
    calls.push({ file, args, opts });
    if (file === 'git' && args[0] === 'status') {
      return { code: scenario.gitStatusCode ?? 0, stdout: scenario.gitStatus ?? '', stderr: '' };
    }
    if (file === 'git' && args[0] === 'check-ignore') {
      return { code: scenario.envFileIgnored === false ? 1 : 0, stdout: '', stderr: '' };
    }
    const joined = args.join(' ');
    if (joined.includes('migration list')) {
      if (scenario.list && !pushed) return scenario.list;
      const remote = pushed ? scenario.remoteAfterPush ?? local : scenario.remote ?? REAL_VERSIONS.slice(0, 7);
      return { code: 0, stdout: historyTable(local, remote) + leak, stderr: '' };
    }
    if (joined.includes('db push --dry-run')) {
      if (scenario.dryRun) return scenario.dryRun;
      const remote = scenario.remote ?? REAL_VERSIONS.slice(0, 7);
      const pending = [...files.keys()].filter((name) => !remote.includes(name.slice(0, 3))).sort();
      return {
        code: 0,
        stdout: '',
        stderr: `DRY RUN: migrations will *not* be pushed to the database.\nWould push these migrations:\n${pending.map((n) => ` • ${n}`).join('\n')}\n${leak}`,
      };
    }
    if (joined.includes('db push')) {
      pushed = true;
      return scenario.push ?? { code: 0, stdout: `Applying migrations...${leak}`, stderr: '' };
    }
    throw new Error(`unexpected command ${file}`);
  });
  const deps = {
    root: ROOT,
    cwd: ROOT,
    env: scenario.env ?? { SUPABASE_DB_URL: DB_URL, EXPO_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co` },
    exec,
    readdir: () => [...files.keys()],
    readFile: (p: string) => {
      const name = p.split(/[\\/]/).pop()!;
      if (name === 'project-ref') {
        if (scenario.linkedRef) return scenario.linkedRef;
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }
      if (name.startsWith('.env')) return scenario.envFileText ?? '';
      const content = files.get(name);
      if (content === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return content;
    },
    stdout: (text: string) => stdout.push(text),
    stderr: (text: string) => stderr.push(text),
    execPath: NODE,
    platform: 'win32',
    exists: (p: string) => p.endsWith('npx-cli.js'),
  };
  const supabaseCalls = () => calls.filter((call) => call.file !== 'git');
  return {
    deps,
    exec,
    calls,
    supabaseCalls,
    out: () => stdout.join(''),
    errText: () => stderr.join(''),
    all: () => stdout.join('') + stderr.join(''),
  };
}

function expectNoSecrets(text: string) {
  expect(text).not.toContain(PASSWORD);
  expect(text).not.toContain(encodeURIComponent(PASSWORD));
  expect(text).not.toContain(DB_URL);
  expect(text).not.toMatch(/postgres(ql)?:\/\/postgres[:.]/);
}

function withFile(name: string, content: string, base = REAL_FILES) {
  return new Map([...base, [name, content]]);
}
function without(name: string, base = REAL_FILES) {
  const copy = new Map(base);
  copy.delete(name);
  return copy;
}

describe('migration runner: arguments and environment', () => {
  it('defaults to check mode and never pushes without --apply', async () => {
    const h = harness();
    expect(runner.parseArgs([]).mode).toBe('check');
    expect(await runner.run([], h.deps)).toBe(EXIT.ok);
    const commands = h.supabaseCalls().map((call) => call.args.join(' '));
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain('migration list');
    expect(commands.some((command) => command.includes('db push'))).toBe(false);
    expect(h.out()).toContain('Pending: 008, 009');
  });

  it.each([
    [['--check', '--apply'], 'either --check or --apply'],
    [['--apply', '--check'], 'either --check or --apply'],
    [['--check', '--check'], 'more than once'],
    [['--env-file'], 'needs a value'],
    [['--confirm-project-ref', '--apply'], 'needs a value'],
    [['--check=yes'], 'takes no value'],
  ])('rejects %j with a usage error', async (argv, message) => {
    const h = harness();
    expect(await runner.run(argv, h.deps)).toBe(EXIT.usage);
    expect(h.errText()).toContain(message);
    expect(h.exec).not.toHaveBeenCalled();
  });

  it('does not echo an unknown argument, which could be a pasted connection string', async () => {
    const h = harness();
    expect(await runner.run([DB_URL], h.deps)).toBe(EXIT.usage);
    expect(h.errText()).toContain('Unknown argument at position 1');
    expectNoSecrets(h.all());
  });

  it('stops with guidance when no connection string is set, without running the CLI', async () => {
    const h = harness({ env: { EXPO_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`, EXPO_PUBLIC_SUPABASE_ANON_KEY: 'eyJx.eyJy.sig' } });
    expect(await runner.run([], h.deps)).toBe(EXIT.failed);
    expect(h.errText()).toContain('No database connection string found. Set SUPABASE_DB_URL');
    expect(h.errText()).toContain('Supabase Dashboard → Project Settings → Database → Connection string');
    expect(h.supabaseCalls()).toEqual([]);
  });

  it('uses SUPABASE_DB_URL, then DATABASE_URL, then POSTGRES_URL, skipping blank values', () => {
    expect(runner.resolveDatabaseUrl({ SUPABASE_DB_URL: 'a', DATABASE_URL: 'b', POSTGRES_URL: 'c' })).toEqual({
      variable: 'SUPABASE_DB_URL',
      url: 'a',
      ignored: ['DATABASE_URL', 'POSTGRES_URL'],
    });
    expect(runner.resolveDatabaseUrl({ SUPABASE_DB_URL: '  ', DATABASE_URL: 'b', POSTGRES_URL: 'c' }).variable).toBe('DATABASE_URL');
    expect(runner.resolveDatabaseUrl({ POSTGRES_URL: 'c' }).variable).toBe('POSTGRES_URL');
    expect(() => runner.resolveDatabaseUrl({ EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: 'x' })).toThrow('No database connection string');
  });

  it.each([
    [`https://${REF}.supabase.co`, 'HTTP address'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl', 'API key'],
    ['sb_secret_abc123', 'API key'],
    [`mysql://root:${PASSWORD}@localhost/db`, 'must start with postgres://'],
    [`postgresql://postgres:pa#ss@db.${REF}.supabase.co:5432/postgres`, 'malformed'],
    ['not a url at all', 'malformed'],
    [`postgresql://db.${REF}.supabase.co:5432/postgres`, 'has no user'],
  ])('rejects a malformed or wrong connection string (%#) without echoing it', async (value, message) => {
    const h = harness({ env: { SUPABASE_DB_URL: value } });
    expect(await runner.run([], h.deps)).toBe(EXIT.failed);
    expect(h.errText()).toContain(message);
    expect(h.all()).not.toContain(value);
    expect(h.supabaseCalls()).toEqual([]);
  });

  it('identifies direct and pooled Supabase targets and prints only host, port and database', () => {
    const direct = runner.parseDatabaseUrl(DB_URL);
    expect(direct).toEqual(expect.objectContaining({ projectRef: REF, kind: 'direct', password: PASSWORD, user: 'postgres' }));
    const pooled = runner.parseDatabaseUrl(POOLER_URL);
    expect(pooled).toEqual(expect.objectContaining({ projectRef: REF, kind: 'pooler', port: '6543' }));
    expect(runner.describeTarget(pooled)).toBe(`aws-0-ap-south-1.pooler.supabase.com:6543/postgres (project ${REF})`);
    expect(runner.parseDatabaseUrl('postgres://postgres:pw@localhost:54322/postgres').kind).toBe('local');
    expect(runner.parseDatabaseUrl('postgres://u:pw@db.example.com/app').projectRef).toBeNull();
  });

  it('redacts the connection string and password, raw or percent-encoded', () => {
    const redact = runner.createRedactor([DB_URL, PASSWORD]);
    const text = redact(`url=${DB_URL} pw=${PASSWORD} enc=${encodeURIComponent(PASSWORD)} PGPASSWORD=${PASSWORD} other=postgres://x:y@h/d`);
    expectNoSecrets(text);
    expect(text).not.toContain('x:y@h');
  });

  it('reads an ignored env file with standard syntax, letting variables already set win', () => {
    const text = [
      '# comment',
      '',
      `SUPABASE_DB_URL="${DB_URL}"`,
      "QUOTED='a=b#c'",
      '  SPACED  =  value  ',
      'EXISTING=from-file',
    ].join('\n');
    const values = runner.readEnvFile('.env.local', { EXISTING: 'from-shell' }, () => text);
    expect(values).toEqual({ SUPABASE_DB_URL: DB_URL, QUOTED: 'a=b#c', SPACED: 'value' });
  });

  it('loads the connection string from --env-file and refuses an env file git would commit', async () => {
    const loaded = harness({ env: {}, envFileText: `SUPABASE_DB_URL=${DB_URL}\n` });
    expect(await runner.run(['--env-file', '.env.local'], loaded.deps)).toBe(EXIT.ok);
    expect(loaded.out()).toContain('Connection string: SUPABASE_DB_URL.');
    expectNoSecrets(loaded.all());

    const tracked = harness({ env: {}, envFileText: `SUPABASE_DB_URL=${DB_URL}\n`, envFileIgnored: false });
    expect(await runner.run(['--env-file=.env.migrations'], tracked.deps)).toBe(EXIT.failed);
    expect(tracked.errText()).toContain('is not ignored by git');
    expect(tracked.supabaseCalls()).toEqual([]);
  });
});

describe('migration runner: local files', () => {
  it('pins the same 008 and 009 hashes as the repository files', () => {
    for (const pin of Object.values(runner.PUBLISHED)) {
      const content = REAL_FILES.get(pin.name)!.replace(/\r\n/g, '\n');
      expect(createHash('sha256').update(content).digest('hex')).toBe(pin.sha256);
    }
    expect(runner.migrationProblems([...REAL_FILES].map(([name, content]) => ({ name, content })))).toEqual([]);
  });

  it.each([
    ['a duplicate number', withFile('009_another_change.sql', 'select 1;'), 'exists more than once'],
    ['a missing migration', without('007_create_investments.sql'), 'Migration 007 is missing'],
    ['a modified 008', withFile('008_server_sync_cursor.sql', `${REAL_FILES.get('008_server_sync_cursor.sql')}\n-- edit`), '008_server_sync_cursor.sql changed'],
    [
      'a modified 009',
      withFile('009_harden_sync_server_time_permissions.sql', 'grant execute on function public.sync_server_time() to anon;'),
      '009_harden_sync_server_time_permissions.sql changed',
    ],
    ['a malformed name', withFile('10_bad.sql', 'select 1;'), 'migration names must look like'],
    ['a gap before a future migration', withFile(`${versionAfter(2)}_skip.sql`, 'select 1;'), `Migration ${versionAfter(1)} is missing`],
  ])('refuses %s before connecting to anything', async (_label, files, message) => {
    const h = harness({ files });
    expect(await runner.run([], h.deps)).toBe(EXIT.failed);
    expect(h.errText()).toContain(message);
    expect(h.exec).not.toHaveBeenCalled();
  });

  it('accepts a valid future migration and reports it as pending', async () => {
    const h = harness({ files: withFile(`${versionAfter(1)}_future_change.sql`, 'select 1;'), remote: REAL_VERSIONS });
    expect(await runner.run([], h.deps)).toBe(EXIT.ok);
    expect(h.out()).toContain(`Pending: ${versionAfter(1)}`);
  });

  it('refuses to run while supabase/migrations has uncommitted changes', async () => {
    const h = harness({ gitStatus: ' M supabase/migrations/009_harden_sync_server_time_permissions.sql\n' });
    expect(await runner.run([], h.deps)).toBe(EXIT.failed);
    expect(h.errText()).toContain('has uncommitted changes');
    expect(h.supabaseCalls()).toEqual([]);
  });
});

describe('migration runner: target confirmation', () => {
  it('requires --confirm-project-ref for --apply', async () => {
    const h = harness();
    expect(await runner.run(['--apply'], h.deps)).toBe(EXIT.usage);
    expect(h.errText()).toContain('--apply needs --confirm-project-ref');
    expect(h.supabaseCalls()).toEqual([]);
  });

  it('refuses a confirmation for a different project', async () => {
    const h = harness();
    expect(await runner.run(['--apply', '--confirm-project-ref', OTHER_REF], h.deps)).toBe(EXIT.failed);
    expect(h.errText()).toContain(`does not match the target project ${REF}`);
    expect(h.supabaseCalls()).toEqual([]);
  });

  it('refuses when the connection string and the app URL name different projects', async () => {
    const h = harness({ env: { SUPABASE_DB_URL: DB_URL, EXPO_PUBLIC_SUPABASE_URL: `https://${OTHER_REF}.supabase.co` } });
    expect(await runner.run([], h.deps)).toBe(EXIT.failed);
    expect(h.errText()).toContain('The project sources disagree');
    expect(h.supabaseCalls()).toEqual([]);
  });

  it('refuses to apply to a host it cannot tie to any project', async () => {
    const h = harness({ env: { SUPABASE_DB_URL: 'postgresql://admin:pw123@db.example.com:5432/app' } });
    expect(await runner.run(['--apply', '--confirm-project-ref', REF], h.deps)).toBe(EXIT.failed);
    expect(h.errText()).toContain('Cannot identify the target project');
    expect(h.supabaseCalls()).toEqual([]);
  });

  it('says when matching relied on the app URL because the host hides the project', async () => {
    const h = harness({ env: { SUPABASE_DB_URL: 'postgresql://admin:pw123@db.example.com:5432/app', EXPO_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co` } });
    expect(await runner.run([], h.deps)).toBe(EXIT.ok);
    expect(h.out()).toContain('does not reveal a project ref; matching used EXPO_PUBLIC_SUPABASE_URL only');
  });
});

describe('migration runner: remote history and apply', () => {
  it('runs the CLI without a shell, with the password only in PGPASSWORD, from a path with spaces', async () => {
    const h = harness();
    await runner.run([], h.deps);
    const [call] = h.supabaseCalls();
    expect(call.file).toBe(NODE);
    expect(call.args[0]).toMatch(/npx-cli\.js$/);
    expect(call.args.slice(1, 3)).toEqual(['--yes', `supabase@${runner.SUPABASE_CLI_VERSION}`]);
    expect(call.opts.cwd).toBe(ROOT);
    const dbUrl = call.args[call.args.indexOf('--db-url') + 1];
    expect(dbUrl).toBe(`postgresql://postgres@db.${REF}.supabase.co:5432/postgres`);
    expect(call.args.join(' ')).not.toContain(encodeURIComponent(PASSWORD));
    expect(call.opts.env.PGPASSWORD).toBe(PASSWORD);
    expect(call.opts.env.SUPABASE_DB_URL).toBeUndefined();
  });

  it('parses the history table and the dry-run list', () => {
    expect(runner.parseMigrationList(historyTable(['001', '002'], ['001']))).toEqual([
      { local: '001', remote: '001' },
      { local: '002', remote: null },
    ]);
    expect(runner.parseDryRun('Would push these migrations:\n • 008_server_sync_cursor.sql\n • 009_x.sql\nFinished')).toEqual([
      '008_server_sync_cursor.sql',
      '009_x.sql',
    ]);
  });

  describe('Supabase CLI 2.119.0 output on Windows (backtick-wrapped cells)', () => {
    const NINE = ['001', '002', '003', '004', '005', '006', '007', '008', '009'];
    const windowsLines = [
      'Local | Remote | Time (UTC)',
      '-------|--------|------------',
      ...NINE.map((v) => ` \`${v}\` | \` \`    | \`${v}\``),
    ];

    it.each([
      ['CRLF', windowsLines.join('\r\n')],
      ['LF', windowsLines.join('\n')],
    ])('reads nine local-only rows from the %s output', (_eol, output) => {
      const rows = runner.parseMigrationList(output);
      expect(rows).toEqual(NINE.map((v) => ({ local: v, remote: null })));

      const plan = runner.planMigrations(NINE, rows);
      expect(plan.applied).toEqual([]);
      expect(plan.pending).toEqual(NINE);
      expect(plan.problems).toEqual([expect.stringContaining('The remote migration history is empty')]);
    });

    it('reads mixed plain and backtick cells, and never takes the Time column as a version', () => {
      const output = [
        '   Local | Remote | Time (UTC)',
        '  -------|--------|------------',
        ' `001` | 001 | `001`',
        ' 002 | `002` | 002',
        ' `003` | ` ` | `003`',
        ' ` ` | `004` | `004`',
        ' ` ` | ` ` | `005`',
        '      |        | 006',
      ].join('\r\n');
      expect(runner.parseMigrationList(output)).toEqual([
        { local: '001', remote: '001' },
        { local: '002', remote: '002' },
        { local: '003', remote: null },
        { local: null, remote: '004' },
      ]);
    });

    it('still accepts digits only once backticks are removed', () => {
      const output = [' `00a` | ` `', ' `1 2` | ` `', ' ``001`` | ` `', ' `001 | ` `', " '001' | ` `", ' 001 | `x`'].join('\n');
      expect(runner.parseMigrationList(output)).toEqual([]);
    });

    it('turns that output into the empty-history refusal instead of an unreadable history', async () => {
      const h = harness({ list: { code: 0, stdout: windowsLines.join('\r\n'), stderr: '' } });
      expect(await runner.run([], h.deps)).toBe(EXIT.failed);
      expect(h.out()).toContain('Recorded as applied on the remote: none');
      expect(h.out()).toContain('Pending: 001, 002, 003, 004, 005, 006, 007, 008, 009');
      expect(h.errText()).toContain('The remote migration history is empty');
      expect(h.errText()).not.toContain('Could not read the remote migration history');
      expect(h.supabaseCalls().map((call) => call.args.join(' ')).some((args) => args.includes('db push'))).toBe(false);
    });
  });

  it.each([
    ['an empty remote history', [], 'remote migration history is empty'],
    ['a remote migration missing locally', [...REAL_VERSIONS.slice(0, 7), '012'], 'records 012, which is not in'],
    ['a pending migration older than an applied one', ['001', '002', '003', '004', '005', '006', '007', '009'], 'would need --include-all'],
  ])('refuses %s, even in check mode', async (_label, remote, message) => {
    const h = harness({ remote });
    expect(await runner.run([], h.deps)).toBe(EXIT.failed);
    expect(h.errText()).toContain(message);
    expect(h.errText()).toContain('Nothing was changed');
  });

  it('treats an unreachable database as a failure before anything starts', async () => {
    const h = harness({
      list: { code: 1, stdout: '', stderr: `failed to connect to postgres: dial tcp: connection refused (${DB_URL})` },
    });
    expect(await runner.run(['--apply', '--confirm-project-ref', REF], h.deps)).toBe(EXIT.failed);
    expect(h.errText()).toContain('Could not read the remote migration history. Nothing was changed.');
    expect(h.supabaseCalls().some((call) => call.args.includes('push'))).toBe(false);
    expectNoSecrets(h.all());
  });

  it('applies pending migrations through the tracked CLI push and verifies the history afterwards', async () => {
    const h = harness({ leakyCli: true });
    expect(await runner.run(['--apply', '--confirm-project-ref', REF, '--verbose'], h.deps)).toBe(EXIT.ok);
    const commands = h.supabaseCalls().map((call) => call.args.filter((arg) => !arg.includes('://')).slice(3).join(' '));
    expect(commands).toEqual([
      'migration list --db-url',
      'db push --dry-run --db-url',
      'db push --yes --db-url',
      'migration list --db-url',
    ]);
    expect(commands.join(' ')).not.toMatch(/include-all|repair|reset/);
    expect(h.out()).toContain(`Applied ${REAL_VERSIONS.slice(7).join(', ')}. The remote history now records ${REAL_VERSIONS.join(', ')}.`);
    expectNoSecrets(h.all());
  });

  it('does nothing when the remote is already up to date', async () => {
    const h = harness({ remote: REAL_VERSIONS });
    expect(await runner.run(['--apply', '--confirm-project-ref', REF], h.deps)).toBe(EXIT.ok);
    expect(h.out()).toContain('already up to date');
    expect(h.supabaseCalls()).toHaveLength(1);
  });

  it('refuses when the CLI dry run disagrees with the history', async () => {
    const h = harness({ dryRun: { code: 0, stdout: 'Would push these migrations:\n • 009_harden_sync_server_time_permissions.sql', stderr: '' } });
    expect(await runner.run(['--apply', '--confirm-project-ref', REF], h.deps)).toBe(EXIT.failed);
    expect(h.errText()).toContain('Nothing was applied');
    expect(h.supabaseCalls().some((call) => call.args.includes('--yes') && call.args.includes('push') && !call.args.includes('--dry-run'))).toBe(false);
  });

  it('reports a failed push with what the history recorded, and exits non-zero', async () => {
    const h = harness({
      push: { code: 1, stdout: '', stderr: `ERROR: syntax error at or near "grant" (SQLSTATE 42601) ${DB_URL}` },
      remoteAfterPush: [...REAL_VERSIONS.slice(0, 8)],
    });
    expect(await runner.run(['--apply', '--confirm-project-ref', REF], h.deps)).toBe(EXIT.failed);
    expect(h.errText()).toContain('stopped with an error');
    expect(h.errText()).toContain('Recorded as applied now: 001, 002, 003, 004, 005, 006, 007, 008.');
    expect(h.out()).not.toContain('Applied 008');
    expectNoSecrets(h.all());
  });

  it('reports an interrupted push as unknown and tells the user to check before retrying', async () => {
    const h = harness({ push: { code: null, signal: 'SIGTERM', stdout: 'Applying migration 008...', stderr: '', started: true } });
    expect(await runner.run(['--apply', '--confirm-project-ref', REF], h.deps)).toBe(EXIT.unknown);
    expect(h.errText()).toContain('result is unknown');
    expect(h.errText()).toContain('run --check');
    expect(h.out()).not.toContain('Applied');
  });

  it('reports a push the history does not confirm as unknown', async () => {
    const h = harness({ remoteAfterPush: REAL_VERSIONS.slice(0, 8) });
    expect(await runner.run(['--apply', '--confirm-project-ref', REF], h.deps)).toBe(EXIT.unknown);
    expect(h.errText()).toContain('does not confirm it');
  });

  it('reports a CLI that cannot start as a failure with nothing applied', async () => {
    const h = harness({ push: { code: null, stdout: '', stderr: '', error: 'ENOENT', started: false } });
    expect(await runner.run(['--apply', '--confirm-project-ref', REF], h.deps)).toBe(EXIT.failed);
    expect(h.errText()).toContain('Could not start the Supabase CLI. Nothing was applied. (ENOENT)');
  });

  it('builds a passwordless --db-url and keeps database variables out of the CLI environment', () => {
    const parsed = runner.parseDatabaseUrl(POOLER_URL);
    const call = runner.buildCliCall({ file: 'supabase', prefix: [] }, parsed, ['migration', 'list'], {
      SUPABASE_DB_URL: POOLER_URL,
      DATABASE_URL: POOLER_URL,
      PATH: 'x',
    });
    expect(call.args).toEqual(['migration', 'list', '--db-url', `postgresql://postgres.${REF}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`]);
    expect(call.env).toEqual({ PATH: 'x', PGPASSWORD: PASSWORD });
  });

  it('prefers an installed CLI from SUPABASE_CLI_PATH', () => {
    expect(runner.resolveCli({ SUPABASE_CLI_PATH: 'C:\\Tools\\Supabase CLI\\supabase.exe' }, {})).toEqual({
      file: 'C:\\Tools\\Supabase CLI\\supabase.exe',
      prefix: [],
    });
  });
});
