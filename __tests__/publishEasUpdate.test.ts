/// <reference types="jest" />

const { readFileSync } = require('fs') as { readFileSync: (path: string, encoding: string) => string };
const { join } = require('path') as { join: (...parts: string[]) => string };

interface ExecResult {
  code: number | null;
  stdout?: string;
  stderr?: string;
  error?: string;
}
interface ExecCall {
  file: string;
  args: string[];
  opts: { cwd: string; timeoutMs: number; inherit?: boolean };
}
interface Publisher {
  EAS_CLI_PACKAGE: string;
  EXIT: { ok: number; failed: number; usage: number };
  parseArgs(argv: string[]): { channel: string; dryRun: boolean };
  parseFingerprint(raw: string): string;
  resolveEasCli(env: Record<string, string | undefined>, deps: object): { file: string; prefix: string[] };
  run(argv: string[], deps: object): Promise<number>;
  unexpectedChanges(porcelain: string): string[];
}

const publisher = require('../scripts/publish-eas-update') as Publisher;
const { EXIT } = publisher;

const ROOT = join('work', 'repo');
const NODE = join('tools', 'node', 'node.exe');
const NPM_BIN = join('tools', 'node', 'node_modules', 'npm', 'bin');
const NPX = join(NPM_BIN, 'npx-cli.js');
const HEAD = '0c302724a0dc80002443d43824f7139256b9b958';
const FP = 'e285b2d54d832ae29782a9ce3fd0238cd5ddd452';
const EAS_JSON = readFileSync(join(process.cwd(), 'eas.json'), 'utf8');

function build(profile: string, channel: string, fingerprint = FP) {
  return {
    id: `${profile}-build`,
    status: 'FINISHED',
    platform: 'ANDROID',
    buildProfile: profile,
    updateChannel: { name: channel },
    fingerprint: { hash: fingerprint },
    runtime: { version: fingerprint },
    gitCommitHash: HEAD,
  };
}

interface Scenario {
  branch?: string;
  status?: string;
  head?: string;
  tip?: string;
  builds?: object[] | string;
  easJson?: string | null;
  fingerprint?: ExecResult;
  buildList?: ExecResult;
  update?: ExecResult;
  fetch?: ExecResult;
  /** Values returned by later rev-parse HEAD calls (the pre-publish re-check). */
  headSequence?: string[];
  tipSequence?: string[];
  statusSequence?: string[];
}

function harness(scenario: Scenario = {}) {
  const calls: ExecCall[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const heads = [...(scenario.headSequence || [])];
  const tips = [...(scenario.tipSequence || [])];
  const statuses = [...(scenario.statusSequence || [])];
  const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: '' });
  const exec = async (file: string, args: string[], opts: ExecCall['opts']): Promise<ExecResult> => {
    calls.push({ file, args, opts });
    if (file === 'git') {
      const joined = args.join(' ');
      if (joined === 'rev-parse --abbrev-ref HEAD') return ok(`${scenario.branch || 'development'}\n`);
      if (joined.startsWith('status')) return ok(statuses.length ? (statuses.shift() as string) : scenario.status ?? '');
      if (joined.startsWith('fetch')) return scenario.fetch || ok('');
      if (joined === 'rev-parse HEAD') return ok(`${heads.length ? heads.shift() : scenario.head || HEAD}\n`);
      if (joined.startsWith('rev-parse origin/')) return ok(`${tips.length ? tips.shift() : scenario.tip || HEAD}\n`);
      throw new Error(`unexpected git call: ${joined}`);
    }
    const easArgs = args.slice(3);
    if (easArgs[0] === 'fingerprint:generate') return scenario.fingerprint || ok(JSON.stringify({ hash: FP, sources: [] }));
    if (easArgs[0] === 'build:list') {
      if (scenario.buildList) return scenario.buildList;
      const builds = scenario.builds === undefined ? [build('preview', 'preview')] : scenario.builds;
      return ok(typeof builds === 'string' ? builds : JSON.stringify(builds));
    }
    if (easArgs[0] === 'update') return scenario.update || { code: 0 };
    throw new Error(`unexpected eas call: ${easArgs.join(' ')}`);
  };
  const deps = {
    root: ROOT,
    env: { npm_execpath: join(NPM_BIN, 'npm-cli.js') } as Record<string, string | undefined>,
    exec,
    readFile: (file: string) => {
      if (scenario.easJson === null) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      expect(file).toBe(join(ROOT, 'eas.json'));
      return scenario.easJson || EAS_JSON;
    },
    stdout: (text: string) => out.push(text),
    stderr: (text: string) => err.push(text),
    execPath: NODE,
    platform: 'win32',
    exists: (candidate: string) => candidate === NPX,
  };
  const easCalls = () => calls.filter((call) => call.file === NODE).map((call) => call.args.slice(3));
  const published = () => easCalls().some((args) => args[0] === 'update');
  return { deps, calls, easCalls, published, stdout: () => out.join(''), stderr: () => err.join('') };
}

describe('arguments', () => {
  it('requires a channel and accepts --dry-run', () => {
    expect(publisher.parseArgs(['--channel', 'preview', '--dry-run'])).toEqual({ channel: 'preview', dryRun: true });
    expect(() => publisher.parseArgs([])).toThrow(/--channel preview or --channel production is required/);
    expect(() => publisher.parseArgs(['--channel'])).toThrow(/needs a value/);
    expect(() => publisher.parseArgs(['--channel', 'preview', '--message', 'x'])).toThrow(/Unknown argument "--message"/);
  });

  it.each([[['--channel', 'staging']], [['--channel', 'development']], [[]], [['--force']]])('exits with a usage error for %p without calling anything', async (argv) => {
    const h = harness();
    expect(await publisher.run(argv, h.deps)).toBe(EXIT.usage);
    expect(h.calls).toEqual([]);
  });
});

describe('EAS CLI resolution', () => {
  it('runs npx through node without a shell', () => {
    expect(publisher.resolveEasCli({}, { execPath: NODE, platform: 'win32', exists: (p: string) => p === NPX })).toEqual({
      file: NODE,
      prefix: [NPX, '--yes', publisher.EAS_CLI_PACKAGE],
    });
  });

  it('prefers the npx next to the npm that launched the script', () => {
    const cli = publisher.resolveEasCli({ npm_execpath: join('other', 'npm', 'bin', 'npm-cli.js') }, { execPath: NODE, platform: 'win32', exists: () => true });
    expect(cli.prefix[0]).toBe(join('other', 'npm', 'bin', 'npx-cli.js'));
  });

  it('fails when npx cannot be found', () => {
    expect(() => publisher.resolveEasCli({}, { execPath: NODE, platform: 'linux', exists: () => false })).toThrow(/Cannot find npx/);
  });
});

describe('output parsing', () => {
  it('reads the fingerprint hash, tolerating leading CLI noise', () => {
    expect(publisher.parseFingerprint(`\uFEFF{"hash":"${FP}"}`)).toBe(FP);
    expect(publisher.parseFingerprint(`Resolved environment\n{"fingerprint":{"hash":"${FP}"}}`)).toBe(FP);
    expect(() => publisher.parseFingerprint('')).toThrow(/no JSON/);
    expect(() => publisher.parseFingerprint('{"sources":[]}')).toThrow(/no hash/);
    expect(() => publisher.parseFingerprint('{broken')).toThrow(/Could not parse/);
  });

  it('ignores only generated Supabase CLI state in the working tree', () => {
    expect(publisher.unexpectedChanges(' M supabase/.temp/cli-latest\n')).toEqual([]);
    expect(publisher.unexpectedChanges(' M supabase/.temp/cli-latest\n M app.json\n?? notes.txt\n')).toEqual(['app.json', 'notes.txt']);
    expect(publisher.unexpectedChanges(' M supabase/migrations/010_fix_account_fk_delete_semantics.sql\n')).toEqual([
      'supabase/migrations/010_fix_account_fk_delete_semantics.sql',
    ]);
  });
});

describe('publish gates', () => {
  it('publishes a preview update when the preview APK matches, with the exact eas arguments', async () => {
    const h = harness({ status: ' M supabase/.temp/cli-latest\n' });
    expect(await publisher.run(['--channel', 'preview'], h.deps)).toBe(EXIT.ok);
    expect(h.easCalls()).toEqual([
      ['fingerprint:generate', '--platform', 'android', '--build-profile', 'preview', '--json', '--non-interactive'],
      ['build:list', '--platform', 'android', '--fingerprint-hash', FP, '--status', 'finished', '--limit', '50', '--json', '--non-interactive'],
      ['update', '--channel', 'preview', '--environment', 'preview', '--platform', 'android', '--message', `sha:${HEAD}`, '--non-interactive'],
    ]);
    const update = h.calls.find((call) => call.file === NODE && call.args[3] === 'update');
    expect(update && update.args.slice(0, 3)).toEqual([NPX, '--yes', publisher.EAS_CLI_PACKAGE]);
    expect(update && update.opts.inherit).toBe(true);
    expect(h.stdout()).toContain('Compatible preview-build profile=preview channel=preview');
  });

  it('never publishes a production update on the strength of a matching preview APK', async () => {
    const h = harness({ branch: 'Production', builds: [build('preview', 'preview')] });
    expect(await publisher.run(['--channel', 'production'], h.deps)).toBe(EXIT.failed);
    expect(h.published()).toBe(false);
    expect(h.stdout()).toMatch(/Rejected preview-build profile=preview channel=preview commit=\w+: channel preview is not production/);
    expect(h.stderr()).toContain('No finished Android build on channel production from profile production-apk or production');
    expect(h.easCalls()[0]).toContain('production-apk');
  });

  it('publishes a production update when a production AAB or APK matches', async () => {
    for (const profile of ['production', 'production-apk']) {
      const h = harness({ branch: 'Production', builds: [build('preview', 'preview'), build(profile, 'production')] });
      expect(await publisher.run(['--channel', 'production'], h.deps)).toBe(EXIT.ok);
      expect(h.easCalls()[2]).toEqual(['update', '--channel', 'production', '--environment', 'production', '--platform', 'android', '--message', `sha:${HEAD}`, '--non-interactive']);
    }
  });

  it('never publishes a preview update on the strength of a production build', async () => {
    const h = harness({ builds: [build('production-apk', 'production')] });
    expect(await publisher.run(['--channel', 'preview'], h.deps)).toBe(EXIT.failed);
    expect(h.published()).toBe(false);
  });

  it('stops after every check with --dry-run', async () => {
    const h = harness();
    expect(await publisher.run(['--channel', 'preview', '--dry-run'], h.deps)).toBe(EXIT.ok);
    expect(h.published()).toBe(false);
    expect(h.stdout()).toContain('Dry run: every check passed.');
  });

  it('honours --dry-run that npm kept as its own config (Windows PowerShell drops the -- separator)', async () => {
    const h = harness();
    h.deps.env = { ...h.deps.env, npm_config_dry_run: 'true' };
    expect(await publisher.run(['--channel', 'preview'], h.deps)).toBe(EXIT.ok);
    expect(h.published()).toBe(false);
    expect(h.stdout()).toContain('Dry run: every check passed.');
  });

  it.each<[string, Scenario, RegExp]>([
    ['the wrong branch', { branch: 'Production' }, /publishes only from branch development; the current branch is Production/],
    ['uncommitted source changes', { status: ' M app/index.tsx\n' }, /uncommitted changes, which eas update would bundle: app\/index.tsx/],
    ['untracked files', { status: '?? scratch.ts\n' }, /scratch\.ts/],
    ['a failed fetch', { fetch: { code: 128, stderr: 'fatal: unable to access' } }, /git fetch --quiet origin development failed: exit code 128/],
    ['a local commit that is not the pushed tip', { tip: 'ffffffffffffffffffffffffffffffffffffffff' }, /is not the tip of origin\/development/],
    ['a missing eas.json', { easJson: null }, /Cannot read eas.json \(ENOENT\)/],
    ['a profile that builds another channel', { easJson: JSON.stringify({ build: { preview: { channel: 'production', environment: 'preview' } } }) }, /channel is "production"/],
    ['a fingerprint failure', { fingerprint: { code: 1, stderr: 'boom' } }, /eas fingerprint:generate failed: exit code 1\nboom/],
    ['a fingerprint timeout', { fingerprint: { code: null, error: 'timeout' } }, /eas fingerprint:generate failed: timeout/],
    ['unparseable fingerprint output', { fingerprint: { code: 0, stdout: 'not json' } }, /printed no JSON/],
    ['a build:list failure', { buildList: { code: 1, stderr: 'network' } }, /eas build:list failed/],
    ['unparseable build:list output', { builds: '{"builds":[]}' }, /not an array of builds/],
    ['no builds for the fingerprint', { builds: [] }, /No finished Android build on channel preview/],
    ['a build with another fingerprint', { builds: [build('preview', 'preview', 'f'.repeat(40))] }, /No finished Android build/],
  ])('refuses to publish on %s', async (_label, scenario, message) => {
    const h = harness(scenario);
    expect(await publisher.run(['--channel', 'preview'], h.deps)).toBe(EXIT.failed);
    expect(h.stderr()).toMatch(message);
    expect(h.published()).toBe(false);
  });

  it('refuses if a newer commit became HEAD and tip during the checks', async () => {
    const newer = 'a'.repeat(40);
    const h = harness({ headSequence: [HEAD, newer], tipSequence: [HEAD, newer] });
    expect(await publisher.run(['--channel', 'preview'], h.deps)).toBe(EXIT.failed);
    expect(h.stderr()).toContain(`HEAD moved from ${HEAD} to ${newer}`);
    expect(h.published()).toBe(false);
  });

  it('refuses if origin moved past HEAD during the checks', async () => {
    const h = harness({ tipSequence: [HEAD, 'b'.repeat(40)] });
    expect(await publisher.run(['--channel', 'preview'], h.deps)).toBe(EXIT.failed);
    expect(h.stderr()).toMatch(/is not the tip of origin\/development/);
    expect(h.published()).toBe(false);
  });

  it('refuses if the working tree changed during the checks', async () => {
    const h = harness({ statusSequence: ['', ' M utils/previewUpdateMarker.ts\n'] });
    expect(await publisher.run(['--channel', 'preview'], h.deps)).toBe(EXIT.failed);
    expect(h.stderr()).toMatch(/utils\/previewUpdateMarker\.ts/);
    expect(h.published()).toBe(false);
  });

  it('runs the re-check after the compatibility check and before eas update', async () => {
    const h = harness();
    await publisher.run(['--channel', 'preview'], h.deps);
    const sequence = h.calls.map((call) => (call.file === 'git' ? `git ${call.args[0]}` : `eas ${call.args[3]}`));
    const buildList = sequence.indexOf('eas build:list');
    const update = sequence.indexOf('eas update');
    expect(sequence.slice(buildList + 1, update)).toEqual(['git rev-parse', 'git status', 'git fetch', 'git rev-parse', 'git rev-parse']);
  });

  it('reports a failed eas update', async () => {
    const h = harness({ update: { code: 1 } });
    expect(await publisher.run(['--channel', 'preview'], h.deps)).toBe(EXIT.failed);
    expect(h.stderr()).toContain('eas update failed: exit code 1');
  });
});

describe('package.json publish scripts', () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { scripts: Record<string, string> };

  it('route update:preview and update:production through the guarded publisher', () => {
    expect(pkg.scripts['update:preview']).toBe('node scripts/publish-eas-update.js --channel preview');
    expect(pkg.scripts['update:production']).toBe('node scripts/publish-eas-update.js --channel production');
  });

  it('contain no direct eas update or EAS CLI publish command', () => {
    for (const [name, command] of Object.entries(pkg.scripts)) {
      expect({ name, direct: /\beas(-cli(@\S*)?)?\s+update\b|\beas\s+update:republish\b/.test(command) }).toEqual({ name, direct: false });
    }
  });
});
