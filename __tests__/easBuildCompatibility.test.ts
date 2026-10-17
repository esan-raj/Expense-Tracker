/// <reference types="jest" />

const { readFileSync } = require('fs') as { readFileSync: (path: string, encoding: string) => string };
const { join } = require('path') as { join: (...parts: string[]) => string };

interface Target {
  branch: string;
  channel: string;
  environment: string;
  fingerprintProfile: string;
  allowedProfiles: readonly string[];
}
interface Criteria {
  fingerprint: string;
  channel: string;
  allowedProfiles: readonly string[];
}
type Build = Record<string, unknown>;
interface Compatibility {
  EXIT: { ok: number; failed: number; usage: number };
  PUBLISH_TARGETS: Record<string, Target>;
  checkProfiles(easConfig: unknown, target: Target): string[];
  describeBuild(build: Build): string;
  evaluateBuild(build: Build, criteria: Criteria): string[];
  findCompatibleBuilds(builds: Build[], criteria: Criteria): { compatible: Build[]; rejected: Array<{ build: Build; reasons: string[] }> };
  parseBuildList(raw: string): Build[];
  run(argv: string[], deps: { readFile: (file: string) => string; stdout: (text: string) => void; stderr: (text: string) => void }): number;
  targetForBranch(branch: string): Target;
  targetForChannel(channel: string): Target;
}

const compat = require('../scripts/eas-build-compatibility') as Compatibility;
const { EXIT, PUBLISH_TARGETS } = compat;

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8').replace(/\r\n/g, '\n');
const EAS_JSON = JSON.parse(read('eas.json'));

const FP = 'e285b2d54d832ae29782a9ce3fd0238cd5ddd452';
const OTHER_FP = 'f8664cc40d5039b3ccc8550905d632e592579c34';

/** Shape returned by `eas build:list --platform android --json` (eas-cli 24.12.1). */
function build(overrides: { id?: string; profile?: string; channel?: string | null; fingerprint?: string | null; runtime?: string | null; status?: string; platform?: string } = {}): Build {
  const fingerprint = overrides.fingerprint === undefined ? FP : overrides.fingerprint;
  const runtime = overrides.runtime === undefined ? fingerprint : overrides.runtime;
  const channel = overrides.channel === undefined ? 'preview' : overrides.channel;
  const result: Build = {
    id: overrides.id || 'a55d1c40-0000-4000-8000-000000000000',
    status: overrides.status || 'FINISHED',
    platform: overrides.platform || 'ANDROID',
    buildProfile: overrides.profile || 'preview',
    distribution: 'INTERNAL',
    appIdentifier: 'com.spendwise.app',
    gitCommitHash: '6a90100be4c3f6f0d7b2e8a1c9d5f4e3b2a19876',
    artifacts: { applicationArchiveUrl: 'https://expo.dev/artifacts/eas/secret-looking-path.apk' },
    initiatingActor: { id: 'actor', displayName: 'someone' },
  };
  if (fingerprint !== null) result.fingerprint = { id: 'fp-id', hash: fingerprint };
  if (runtime !== null) result.runtime = { id: 'rt-id', version: runtime };
  if (channel !== null) result.updateChannel = { id: 'ch-id', name: channel };
  return result;
}

const previewApk = build({ id: 'preview-apk', profile: 'preview', channel: 'preview' });
const productionApk = build({ id: 'production-apk', profile: 'production-apk', channel: 'production' });
const productionAab = build({ id: 'production-aab', profile: 'production', channel: 'production' });

const criteriaFor = (channel: string): Criteria => {
  const target = compat.targetForChannel(channel);
  return { fingerprint: FP, channel: target.channel, allowedProfiles: target.allowedProfiles };
};

function harness(files: Record<string, string>) {
  const out: string[] = [];
  const err: string[] = [];
  const deps = {
    readFile: (file: string) => {
      if (!(file in files)) throw Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' });
      return files[file];
    },
    stdout: (text: string) => out.push(text),
    stderr: (text: string) => err.push(text),
  };
  return { deps, stdout: () => out.join(''), stderr: () => err.join('') };
}

describe('publish targets', () => {
  it('maps branches to channels, environments and allowed build profiles exactly', () => {
    expect(PUBLISH_TARGETS).toEqual({
      development: {
        branch: 'development',
        channel: 'preview',
        environment: 'preview',
        fingerprintProfile: 'preview',
        allowedProfiles: ['preview'],
      },
      Production: {
        branch: 'Production',
        channel: 'production',
        environment: 'production',
        fingerprintProfile: 'production-apk',
        allowedProfiles: ['production-apk', 'production'],
      },
    });
  });

  it.each(['main', 'production', 'Development', 'constructor', '__proto__', ''])('refuses branch %p', (branch) => {
    expect(() => compat.targetForBranch(branch)).toThrow(/unexpected branch/);
  });

  it.each(['development', 'staging', 'Production', ''])('refuses channel %p', (channel) => {
    expect(() => compat.targetForChannel(channel)).toThrow(/unexpected channel/);
  });
});

describe('eas.json profiles', () => {
  it('bakes the target channel and environment into every allowed profile in this repository', () => {
    expect(compat.checkProfiles(EAS_JSON, PUBLISH_TARGETS.development)).toEqual([]);
    expect(compat.checkProfiles(EAS_JSON, PUBLISH_TARGETS.Production)).toEqual([]);
  });

  it('rejects an allowed profile that builds for another channel', () => {
    const config = JSON.parse(JSON.stringify(EAS_JSON));
    config.build['production-apk'].channel = 'preview';
    expect(compat.checkProfiles(config, PUBLISH_TARGETS.Production)).toEqual([
      expect.stringContaining('"production-apk" channel is "preview"'),
    ]);
  });

  it('rejects a profile with no channel instead of assuming it matches', () => {
    const config = JSON.parse(JSON.stringify(EAS_JSON));
    delete config.build.preview.channel;
    expect(compat.checkProfiles(config, PUBLISH_TARGETS.development)).toEqual([
      expect.stringContaining('"preview" channel is "(none)"'),
    ]);
  });

  it('rejects a mismatched environment, a missing profile and a circular extends chain', () => {
    const config = JSON.parse(JSON.stringify(EAS_JSON));
    config.build.production.environment = 'preview';
    expect(compat.checkProfiles(config, PUBLISH_TARGETS.Production)).toEqual([
      expect.stringContaining('"production-apk" environment is "preview"'),
      expect.stringContaining('"production" environment is "preview"'),
    ]);
    delete config.build.production;
    expect(compat.checkProfiles(config, PUBLISH_TARGETS.Production)).toEqual([
      expect.stringContaining('no build profile named "production"'),
      expect.stringContaining('no build profile named "production"'),
    ]);
    const circular = { build: { 'production-apk': { extends: 'production' }, production: { extends: 'production-apk' } } };
    expect(compat.checkProfiles(circular, PUBLISH_TARGETS.Production)[0]).toMatch(/circular extends/);
  });
});

describe('build compatibility', () => {
  it('accepts a preview APK on channel preview for a preview update', () => {
    expect(compat.evaluateBuild(previewApk, criteriaFor('preview'))).toEqual([]);
  });

  it('accepts both production-apk and production AAB builds on channel production', () => {
    expect(compat.evaluateBuild(productionApk, criteriaFor('production'))).toEqual([]);
    expect(compat.evaluateBuild(productionAab, criteriaFor('production'))).toEqual([]);
  });

  it('never lets a matching preview APK authorize a production update', () => {
    const { compatible, rejected } = compat.findCompatibleBuilds([previewApk], criteriaFor('production'));
    expect(compatible).toEqual([]);
    expect(rejected[0].reasons).toEqual([
      'channel preview is not production',
      'profile preview is not allowed for channel production (allowed: production-apk, production)',
    ]);
  });

  it('never lets a matching production build authorize a preview update', () => {
    const { compatible, rejected } = compat.findCompatibleBuilds([productionApk, productionAab], criteriaFor('preview'));
    expect(compatible).toEqual([]);
    expect(rejected.map((r) => r.reasons[0])).toEqual(['channel production is not preview', 'channel production is not preview']);
  });

  it('rejects an allowed profile that reports the wrong channel, and the right channel from a disallowed profile', () => {
    const miswired = build({ profile: 'production-apk', channel: 'preview' });
    expect(compat.evaluateBuild(miswired, criteriaFor('production'))).toEqual(['channel preview is not production']);
    const devClient = build({ profile: 'development', channel: 'production' });
    expect(compat.evaluateBuild(devClient, criteriaFor('production'))).toEqual([
      'profile development is not allowed for channel production (allowed: production-apk, production)',
    ]);
  });

  it('rejects a different fingerprint or runtime', () => {
    expect(compat.evaluateBuild(build({ fingerprint: OTHER_FP }), criteriaFor('preview'))).toEqual([
      `fingerprint ${OTHER_FP} differs`,
      `runtime ${OTHER_FP} differs`,
    ]);
    expect(compat.evaluateBuild(build({ runtime: OTHER_FP }), criteriaFor('preview'))).toEqual([`runtime ${OTHER_FP} differs`]);
  });

  it('rejects legacy builds that recorded no channel or runtime instead of assuming they match', () => {
    const legacy = build({ channel: null, runtime: null });
    expect(compat.evaluateBuild(legacy, criteriaFor('preview'))).toEqual(['no runtime version recorded', 'no channel recorded']);
    expect(compat.evaluateBuild(build({ fingerprint: null, runtime: null }), criteriaFor('preview'))).toEqual([
      'no fingerprint recorded',
      'no runtime version recorded',
    ]);
  });

  it('rejects unfinished and non-Android builds', () => {
    expect(compat.evaluateBuild(build({ status: 'ERRORED' }), criteriaFor('preview'))).toEqual(['status ERRORED is not FINISHED']);
    expect(compat.evaluateBuild(build({ platform: 'IOS' }), criteriaFor('preview'))).toEqual(['platform IOS is not ANDROID']);
  });

  it('requires a fingerprint to compare against', () => {
    expect(() => compat.findCompatibleBuilds([previewApk], { ...criteriaFor('preview'), fingerprint: '' })).toThrow(/fingerprint hash is required/);
  });

  it('describes builds without artifact URLs or the initiating actor', () => {
    const text = compat.describeBuild(previewApk);
    expect(text).toBe('preview-apk profile=preview channel=preview commit=6a90100be4c3');
    expect(text).not.toMatch(/artifacts|secret-looking|someone/);
  });
});

describe('build list parsing', () => {
  it('reads the array printed by eas build:list --json', () => {
    expect(compat.parseBuildList(`\uFEFF${JSON.stringify([previewApk])}\n`)).toHaveLength(1);
    expect(compat.parseBuildList('[]')).toEqual([]);
  });

  it.each([
    ['empty output', '', /no output/],
    ['non-JSON', 'Fetching builds...', /not JSON/],
    ['an object', '{"builds":[]}', /not an array of builds \(got object with keys builds\)/],
    ['a non-object entry', '[1]', /entry 0 is not a build object/],
  ])('fails closed on %s', (_label, raw, message) => {
    expect(() => compat.parseBuildList(raw)).toThrow(message);
  });
});

describe('command line', () => {
  it('prints the publish target for a branch', () => {
    const h = harness({});
    expect(compat.run(['target', '--branch', 'Production'], h.deps)).toBe(EXIT.ok);
    expect(h.stdout()).toBe('channel=production\nenvironment=production\nprofile=production-apk\nallowed_profiles=production-apk,production\n');
  });

  it('refuses an unknown branch with a usage exit code', () => {
    const h = harness({});
    expect(compat.run(['target', '--branch', 'main'], h.deps)).toBe(EXIT.usage);
    expect(h.stderr()).toContain('unexpected branch "main"');
  });

  it('validates eas.json profiles', () => {
    const ok = harness({ 'eas.json': read('eas.json') });
    expect(compat.run(['profiles', '--channel', 'production'], ok.deps)).toBe(EXIT.ok);
    const bad = harness({ 'eas.json': JSON.stringify({ build: { preview: { channel: 'production', environment: 'preview' } } }) });
    expect(compat.run(['profiles', '--channel', 'preview'], bad.deps)).toBe(EXIT.failed);
    const missing = harness({});
    expect(compat.run(['profiles', '--channel', 'preview'], missing.deps)).toBe(EXIT.usage);
    expect(missing.stderr()).toContain('Cannot read eas.json (ENOENT)');
  });

  it('blocks the production update when only a matching preview APK exists', () => {
    const h = harness({ 'builds.json': JSON.stringify([previewApk]) });
    expect(compat.run(['check', '--channel', 'production', '--fingerprint', FP, '--builds-file', 'builds.json'], h.deps)).toBe(EXIT.failed);
    expect(h.stdout()).toContain('Rejected preview-apk profile=preview channel=preview');
    expect(h.stderr()).toContain('No finished Android build on channel production from profile production-apk or production');
  });

  it('allows the production update when a production build matches', () => {
    const h = harness({ 'builds.json': JSON.stringify([previewApk, productionAab]) });
    expect(compat.run(['check', '--channel', 'production', '--fingerprint', FP, '--builds-file', 'builds.json'], h.deps)).toBe(EXIT.ok);
    expect(h.stdout()).toContain('Compatible production-aab profile=production channel=production');
    expect(h.stdout()).toContain('Found 1 compatible build(s) for channel production.');
  });

  it('allows the preview update when the preview APK matches', () => {
    const h = harness({ 'builds.json': JSON.stringify([productionApk, previewApk]) });
    expect(compat.run(['check', '--channel', 'preview', '--fingerprint', FP, '--builds-file', 'builds.json'], h.deps)).toBe(EXIT.ok);
  });

  it('fails when no builds are returned and warns when the lookup limit was reached', () => {
    const none = harness({ 'builds.json': '[]' });
    expect(compat.run(['check', '--channel', 'preview', '--fingerprint', FP, '--builds-file', 'builds.json'], none.deps)).toBe(EXIT.failed);
    const full = harness({ 'builds.json': JSON.stringify([productionApk, productionAab]) });
    expect(compat.run(['check', '--channel', 'preview', '--fingerprint', FP, '--builds-file', 'builds.json', '--limit', '2'], full.deps)).toBe(EXIT.failed);
    expect(full.stdout()).toContain('returned the maximum of 2 builds');
  });

  it.each([
    [['check', '--channel', 'preview', '--builds-file', 'builds.json']],
    [['check', '--channel', 'preview', '--fingerprint', '', '--builds-file', 'builds.json']],
    [['check', '--channel', 'preview', '--fingerprint', FP]],
    [['check', '--channel', 'preview', '--fingerprint', FP, '--builds-file', 'missing.json']],
    [['check', '--channel', 'staging', '--fingerprint', FP, '--builds-file', 'builds.json']],
    [['check', '--branch', 'development', '--channel', 'preview', '--fingerprint', FP, '--builds-file', 'builds.json']],
    [['check', '--channel', 'preview', '--fingerprint', FP, '--builds-file', 'broken.json']],
    [['check', '--channel', 'preview', '--fingerprint', FP, '--builds-file', 'builds.json', '--extra', 'x']],
    [['publish']],
    [[]],
  ])('exits with a usage error for %p', (argv) => {
    const h = harness({ 'builds.json': JSON.stringify([previewApk]), 'broken.json': '{' });
    expect(compat.run(argv, h.deps)).toBe(EXIT.usage);
    expect(h.stderr()).toMatch(/^::error::/);
  });
});

describe('publishing paths', () => {
  const workflow = read('.github/workflows/eas-update.yml');
  const script = read('scripts/publish-eas-update.sh');

  it('publishes only on pushes to development and Production', () => {
    const on = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\npermissions:'));
    expect(on).toBe('\non:\n  push:\n    branches:\n      - development\n      - Production\n');
  });

  it('resolves the target, checks profiles and checks channel compatibility before the branch-tip check and eas update', () => {
    const steps = [
      'node scripts/eas-build-compatibility.js target --branch "${GITHUB_REF_NAME}"',
      'node scripts/eas-build-compatibility.js profiles --channel "$CHANNEL"',
      'eas fingerprint:generate "${FP_ARGS[@]}"',
      'node scripts/eas-build-compatibility.js check --channel "$CHANNEL" --fingerprint "$HASH" --builds-file "$BUILDS_JSON"',
      'echo "Branch-tip check immediately before eas update."',
      'eas update \\',
    ];
    const positions = steps.map((step) => workflow.indexOf(step));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(workflow.split('eas update \\').length - 1).toBe(1);
  });

  it('runs nothing between the branch-tip check and eas update other than the skip guard', () => {
    const between = workflow.slice(workflow.indexOf('echo "Branch-tip check immediately before eas update."'), workflow.indexOf('eas update \\'));
    expect(between).not.toMatch(/\beas (build|fingerprint)|node /);
  });

  it('fails closed on any non-zero compatibility result in both publishing paths', () => {
    for (const source of [workflow, script]) {
      expect(source).toContain('CHECK_STATUS=$?');
      expect(source).not.toMatch(/MATCH_COUNT|builds\.length/);
      const afterCheck = source.slice(source.indexOf('CHECK_STATUS=$?'));
      expect(afterCheck.indexOf('exit "$CHECK_STATUS"')).toBeLessThan(afterCheck.indexOf('eas update \\'));
      expect(afterCheck.indexOf('exit 1')).toBeLessThan(afterCheck.indexOf('eas update \\'));
    }
  });

  it('gates the local publish script on the same checker before eas update', () => {
    const steps = [
      'node "$COMPATIBILITY" target --channel "$CHANNEL"',
      'node "$COMPATIBILITY" profiles --channel "$CHANNEL"',
      'node "$COMPATIBILITY" check --channel "$CHANNEL" --fingerprint "$HASH" --builds-file "$BUILDS_JSON"',
      'eas update \\',
    ];
    const positions = steps.map((step) => script.indexOf(step));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('keeps EXPO_TOKEN out of pull-request workflows', () => {
    for (const file of ['.github/workflows/checks.yml', '.github/workflows/release-source.yml']) {
      const source = read(file);
      expect(source).toContain('pull_request:');
      expect(source).not.toMatch(/secrets\.|EXPO_TOKEN|eas update|pull_request_target/);
    }
    expect(workflow).not.toMatch(/pull_request/);
  });
});
