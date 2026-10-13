#!/usr/bin/env node
'use strict';
/**
 * Guarded local EAS Update publisher (cross-platform; no shell).
 *
 *   node scripts/publish-eas-update.js --channel preview|production [--dry-run]
 *   npm run update:preview -- --dry-run
 *
 * Publishes the current commit only when it is the fetched tip of the channel's Git branch, the
 * working tree is clean, and a finished Android build on that exact channel, from an allowed
 * profile, matches the commit's fingerprint (scripts/eas-build-compatibility.js). The branch tip
 * and working tree are checked again immediately before `eas update`. --dry-run runs every check
 * and stops before publishing. Exit codes: 0 published / dry run passed, 1 refused or failed,
 * 2 usage.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const compat = require('./eas-build-compatibility');

const EXIT = Object.freeze({ ok: 0, failed: 1, usage: 2 });
const EAS_CLI_PACKAGE = 'eas-cli@latest';
const BUILD_LIMIT = 50;
/** Generated Supabase CLI state; never part of the app bundle. */
const IGNORED_CHANGES = ['supabase/.temp/'];
const TIMEOUT = Object.freeze({ git: 120000, query: 600000, publish: 1800000 });

class PublishError extends Error {
  constructor(message, code = EXIT.failed) {
    super(message);
    this.code = code;
  }
}

function parseArgs(argv) {
  const options = { channel: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--channel') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new PublishError('--channel needs a value.', EXIT.usage);
      options.channel = value;
      i += 1;
    } else throw new PublishError(`Unknown argument "${arg}".`, EXIT.usage);
  }
  if (!options.channel) throw new PublishError('--channel preview or --channel production is required.', EXIT.usage);
  return options;
}

/** npx from the running Node installation, invoked through node itself so no shell is needed. */
function resolveEasCli(env, { execPath = process.execPath, platform = process.platform, exists = fs.existsSync } = {}) {
  const nodeDir = path.dirname(execPath);
  const candidates = [
    env.npm_execpath ? path.join(path.dirname(env.npm_execpath), 'npx-cli.js') : null,
    platform === 'win32'
      ? path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js')
      : path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ].filter(Boolean);
  const npx = candidates.find((candidate) => exists(candidate));
  if (!npx) throw new PublishError('Cannot find npx next to this Node installation to run the EAS CLI.');
  return { file: execPath, prefix: [npx, '--yes', EAS_CLI_PACKAGE] };
}

function execCommand(file, args, { cwd, env, timeoutMs, inherit = false }) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, ...result });
    };
    let child;
    try {
      child = spawn(file, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: inherit ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish({ code: null, error: (error && error.code) || 'spawn failed' });
      return;
    }
    timer = setTimeout(() => {
      child.kill();
      finish({ code: null, error: 'timeout' });
    }, timeoutMs);
    if (!inherit) {
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
    }
    child.on('error', (error) => finish({ code: null, error: (error && error.code) || 'error' }));
    child.on('close', (code) => finish({ code }));
  });
}

function describeFailure(result) {
  if (result.error) return result.error;
  const detail = String(result.stderr || '').trim().split(/\r?\n/).slice(-5).join('\n');
  return `exit code ${result.code}${detail ? `\n${detail}` : ''}`;
}

function parseFingerprint(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '').trim();
  const start = text.indexOf('{');
  if (start < 0) throw new PublishError('eas fingerprint:generate printed no JSON.');
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start));
  } catch (error) {
    throw new PublishError(`Could not parse eas fingerprint:generate JSON (${error.message}).`);
  }
  const hash = parsed.hash || parsed.fingerprintHash || (parsed.fingerprint && parsed.fingerprint.hash);
  if (typeof hash !== 'string' || !hash) throw new PublishError('eas fingerprint:generate JSON had no hash.');
  return hash;
}

function unexpectedChanges(porcelain) {
  return String(porcelain)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/^"|"$/g, ''))
    .filter((file) => !IGNORED_CHANGES.some((prefix) => file.startsWith(prefix)));
}

async function run(argv, deps) {
  const { stdout, stderr } = deps;
  const say = (text) => stdout(`${text}\n`);
  try {
    const options = parseArgs(argv);
    // Windows PowerShell drops the `--` in `npm run update:preview -- --dry-run`, so npm keeps the
    // flag as its own config and the script never sees it.
    if (deps.env.npm_config_dry_run === 'true') options.dryRun = true;
    let target;
    try {
      target = compat.targetForChannel(options.channel);
    } catch (error) {
      throw new PublishError(error.message, EXIT.usage);
    }
    const git = async (args) => {
      const result = await deps.exec('git', args, { cwd: deps.root, env: deps.env, timeoutMs: TIMEOUT.git });
      if (result.code !== 0) throw new PublishError(`git ${args.join(' ')} failed: ${describeFailure(result)}`);
      return result.stdout;
    };
    const cli = resolveEasCli(deps.env, deps);
    const eas = (args, timeoutMs, inherit = false) =>
      deps.exec(cli.file, [...cli.prefix, ...args], { cwd: deps.root, env: deps.env, timeoutMs, inherit });

    const verifySource = async () => {
      const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
      if (branch !== target.branch) {
        throw new PublishError(`Channel ${target.channel} publishes only from branch ${target.branch}; the current branch is ${branch}.`);
      }
      const changes = unexpectedChanges(await git(['status', '--porcelain=v1', '--untracked-files=all']));
      if (changes.length) {
        throw new PublishError(`The working tree has uncommitted changes, which eas update would bundle: ${changes.join(', ')}.`);
      }
      await git(['fetch', '--quiet', 'origin', target.branch]);
      const head = (await git(['rev-parse', 'HEAD'])).trim();
      const tip = (await git(['rev-parse', `origin/${target.branch}`])).trim();
      if (head !== tip) {
        throw new PublishError(`HEAD ${head} is not the tip of origin/${target.branch} (${tip}). Publish only the pushed, validated tip.`);
      }
      return head;
    };

    say(`Channel ${target.channel} (environment ${target.environment}) from branch ${target.branch}; allowed build profiles: ${target.allowedProfiles.join(', ')}.`);
    const head = await verifySource();
    say(`Commit: ${head}`);

    let easConfig;
    try {
      easConfig = JSON.parse(deps.readFile(path.join(deps.root, 'eas.json'), 'utf8'));
    } catch (error) {
      throw new PublishError(`Cannot read eas.json (${error.code || error.message}).`);
    }
    const problems = compat.checkProfiles(easConfig, target);
    if (problems.length) throw new PublishError(problems.join('\n'));

    say(`Generating the Android fingerprint with build profile ${target.fingerprintProfile}...`);
    const fingerprint = await eas(
      ['fingerprint:generate', '--platform', 'android', '--build-profile', target.fingerprintProfile, '--json', '--non-interactive'],
      TIMEOUT.query
    );
    if (fingerprint.code !== 0) throw new PublishError(`eas fingerprint:generate failed: ${describeFailure(fingerprint)}`);
    const hash = parseFingerprint(fingerprint.stdout);
    say(`Android fingerprint: ${hash}`);

    const list = await eas(
      ['build:list', '--platform', 'android', '--fingerprint-hash', hash, '--status', 'finished', '--limit', String(BUILD_LIMIT), '--json', '--non-interactive'],
      TIMEOUT.query
    );
    if (list.code !== 0) throw new PublishError(`eas build:list failed: ${describeFailure(list)}`);
    let builds;
    try {
      builds = compat.parseBuildList(list.stdout);
    } catch (error) {
      throw new PublishError(error.message);
    }
    const { compatible, rejected } = compat.findCompatibleBuilds(builds, {
      fingerprint: hash,
      channel: target.channel,
      allowedProfiles: target.allowedProfiles,
    });
    for (const { build, reasons } of rejected) say(`Rejected ${compat.describeBuild(build)}: ${reasons.join('; ')}`);
    if (compatible.length === 0) {
      throw new PublishError(
        [
          `No finished Android build on channel ${target.channel} from profile ${target.allowedProfiles.join(' or ')} matches fingerprint ${hash}.`,
          `Installed binaries on channel ${target.channel} would not receive this update, so nothing was published.`,
          `Build and install a compatible binary first: npx eas-cli@latest build --profile ${target.fingerprintProfile} --platform android`,
        ].join('\n')
      );
    }
    for (const build of compatible) say(`Compatible ${compat.describeBuild(build)}`);

    const message = `sha:${head}`;
    const updateArgs = ['update', '--channel', target.channel, '--environment', target.environment, '--platform', 'android', '--message', message, '--non-interactive'];
    if (options.dryRun) {
      say(`Dry run: every check passed. Not running: eas ${updateArgs.join(' ')}`);
      return EXIT.ok;
    }

    say('Re-checking the branch tip and working tree immediately before eas update...');
    const recheck = await verifySource();
    if (recheck !== head) throw new PublishError(`HEAD moved from ${head} to ${recheck} during the checks. Nothing was published.`);

    say(`Publishing ${head} to channel ${target.channel} with environment ${target.environment}...`);
    const update = await eas(updateArgs, TIMEOUT.publish, true);
    if (update.code !== 0) throw new PublishError(`eas update failed: ${describeFailure(update)}`);
    say(`Published to channel ${target.channel}. Installed ${target.allowedProfiles.join(' or ')} binaries with fingerprint ${hash} can download it.`);
    return EXIT.ok;
  } catch (error) {
    if (!(error instanceof PublishError)) throw error;
    stderr(`Error: ${error.message}\n`);
    return error.code;
  }
}

function defaultDeps() {
  return {
    root: path.resolve(__dirname, '..'),
    env: process.env,
    exec: execCommand,
    readFile: fs.readFileSync,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    execPath: process.execPath,
    platform: process.platform,
    exists: fs.existsSync,
  };
}

module.exports = {
  EAS_CLI_PACKAGE,
  EXIT,
  IGNORED_CHANGES,
  PublishError,
  defaultDeps,
  execCommand,
  parseArgs,
  parseFingerprint,
  resolveEasCli,
  run,
  unexpectedChanges,
};

if (require.main === module) {
  run(process.argv.slice(2), defaultDeps()).then((code) => {
    process.exitCode = code;
  });
}
