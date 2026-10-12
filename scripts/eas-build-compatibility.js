#!/usr/bin/env node
'use strict';
/**
 * Decides whether an EAS Update may be published: a finished Android build must exist with the
 * same fingerprint and runtime, on the exact target channel, from a build profile allowed for
 * that channel. A preview build never authorizes a production update, and the reverse.
 *
 *   node scripts/eas-build-compatibility.js target --branch <git-branch> | --channel <channel>
 *   node scripts/eas-build-compatibility.js profiles --channel <channel> [--eas-json eas.json]
 *   node scripts/eas-build-compatibility.js check --channel <channel> --fingerprint <hash> --builds-file <file> [--limit <n>]
 *
 * --builds-file holds the stdout of `eas build:list --platform android --json`. Exit codes:
 * 0 compatible / valid, 1 no compatible build or invalid profiles, 2 usage or unreadable input.
 */
const fs = require('node:fs');

const EXIT = Object.freeze({ ok: 0, failed: 1, usage: 2 });

const PUBLISH_TARGETS = Object.freeze({
  development: Object.freeze({
    branch: 'development',
    channel: 'preview',
    environment: 'preview',
    fingerprintProfile: 'preview',
    allowedProfiles: Object.freeze(['preview']),
  }),
  Production: Object.freeze({
    branch: 'Production',
    channel: 'production',
    environment: 'production',
    fingerprintProfile: 'production-apk',
    allowedProfiles: Object.freeze(['production-apk', 'production']),
  }),
});

class CompatibilityError extends Error {}

function targetForBranch(branch) {
  const target = Object.prototype.hasOwnProperty.call(PUBLISH_TARGETS, branch) ? PUBLISH_TARGETS[branch] : null;
  if (!target) throw new CompatibilityError(`Refusing to publish from unexpected branch "${branch}".`);
  return target;
}

function targetForChannel(channel) {
  const target = Object.values(PUBLISH_TARGETS).find((candidate) => candidate.channel === channel);
  if (!target) throw new CompatibilityError(`Refusing to publish to unexpected channel "${channel}".`);
  return target;
}

function resolveProfile(easConfig, name, seen = new Set()) {
  if (seen.has(name)) throw new CompatibilityError(`eas.json build profile "${name}" has a circular extends chain.`);
  seen.add(name);
  const profile = easConfig && easConfig.build && Object.prototype.hasOwnProperty.call(easConfig.build, name)
    ? easConfig.build[name]
    : null;
  if (!profile || typeof profile !== 'object') throw new CompatibilityError(`eas.json has no build profile named "${name}".`);
  if (profile.extends) return { ...resolveProfile(easConfig, profile.extends, seen), ...profile };
  return profile;
}

/** Every allowed profile must bake in the target channel and use the target EAS environment. */
function checkProfiles(easConfig, target) {
  const problems = [];
  for (const name of target.allowedProfiles) {
    let profile;
    try {
      profile = resolveProfile(easConfig, name);
    } catch (error) {
      problems.push(error.message);
      continue;
    }
    if (profile.channel !== target.channel) {
      problems.push(`Build profile "${name}" channel is "${profile.channel || '(none)'}", but channel ${target.channel} requires "${target.channel}".`);
    }
    if (profile.environment !== target.environment) {
      problems.push(`Build profile "${name}" environment is "${profile.environment || '(none)'}", but eas update will use --environment ${target.environment}.`);
    }
  }
  if (!target.allowedProfiles.includes(target.fingerprintProfile)) {
    problems.push(`Fingerprint profile "${target.fingerprintProfile}" is not an allowed profile for channel ${target.channel}.`);
  }
  return problems;
}

function parseBuildList(raw) {
  const text = String(raw == null ? '' : raw).replace(/^\uFEFF/, '').trim();
  if (!text) throw new CompatibilityError('eas build:list returned no output.');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new CompatibilityError(`eas build:list output is not JSON (${error.message}).`);
  }
  if (!Array.isArray(parsed)) {
    const shape = parsed && typeof parsed === 'object' ? `object with keys ${Object.keys(parsed).join(', ') || '(none)'}` : typeof parsed;
    throw new CompatibilityError(`eas build:list JSON is not an array of builds (got ${shape}).`);
  }
  parsed.forEach((build, index) => {
    if (!build || typeof build !== 'object' || Array.isArray(build)) {
      throw new CompatibilityError(`eas build:list entry ${index} is not a build object.`);
    }
  });
  return parsed;
}

function field(value) {
  return typeof value === 'string' && value ? value : null;
}

/** Reasons a build cannot receive the update; empty means compatible. */
function evaluateBuild(build, { fingerprint, channel, allowedProfiles }) {
  const reasons = [];
  const status = field(build.status);
  const platform = field(build.platform);
  const hash = field(build.fingerprint && build.fingerprint.hash);
  const runtime = field(build.runtime && build.runtime.version);
  const buildChannel = field(build.updateChannel && build.updateChannel.name);
  const profile = field(build.buildProfile);

  if (status !== 'FINISHED') reasons.push(`status ${status || '(none)'} is not FINISHED`);
  if (platform !== 'ANDROID') reasons.push(`platform ${platform || '(none)'} is not ANDROID`);
  if (hash !== fingerprint) reasons.push(hash ? `fingerprint ${hash} differs` : 'no fingerprint recorded');
  if (runtime !== fingerprint) reasons.push(runtime ? `runtime ${runtime} differs` : 'no runtime version recorded');
  if (buildChannel !== channel) reasons.push(buildChannel ? `channel ${buildChannel} is not ${channel}` : 'no channel recorded');
  if (!profile || !allowedProfiles.includes(profile)) {
    reasons.push(`profile ${profile || '(none)'} is not allowed for channel ${channel} (allowed: ${allowedProfiles.join(', ')})`);
  }
  return reasons;
}

function findCompatibleBuilds(builds, criteria) {
  if (!field(criteria.fingerprint)) throw new CompatibilityError('A fingerprint hash is required.');
  const compatible = [];
  const rejected = [];
  for (const build of builds) {
    const reasons = evaluateBuild(build, criteria);
    if (reasons.length === 0) compatible.push(build);
    else rejected.push({ build, reasons });
  }
  return { compatible, rejected };
}

/** Only identifiers and release metadata; never artifacts, log URLs or the initiating actor. */
function describeBuild(build) {
  const id = field(build.id) || '(unknown id)';
  const profile = field(build.buildProfile) || '(none)';
  const channel = field(build.updateChannel && build.updateChannel.name) || '(none)';
  const commit = (field(build.gitCommitHash) || '(unknown)').slice(0, 12);
  return `${id} profile=${profile} channel=${channel} commit=${commit}`;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const match = /^--(branch|channel|fingerprint|builds-file|eas-json|limit)$/.exec(flag);
    if (!match) throw new CompatibilityError(`Unknown argument "${flag}".`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) throw new CompatibilityError(`${flag} needs a value.`);
    options[match[1]] = value;
    i += 1;
  }
  return { command, options };
}

function targetFromOptions(options) {
  if (options.branch && options.channel) throw new CompatibilityError('Pass either --branch or --channel, not both.');
  if (options.branch) return targetForBranch(options.branch);
  if (options.channel) return targetForChannel(options.channel);
  throw new CompatibilityError('--branch or --channel is required.');
}

function run(argv, deps) {
  const { readFile, stdout, stderr } = deps;
  try {
    const { command, options } = parseArgs(argv);
    if (command === 'target') {
      const target = targetFromOptions(options);
      stdout(`channel=${target.channel}\n`);
      stdout(`environment=${target.environment}\n`);
      stdout(`profile=${target.fingerprintProfile}\n`);
      stdout(`allowed_profiles=${target.allowedProfiles.join(',')}\n`);
      return EXIT.ok;
    }
    if (command === 'profiles') {
      const target = targetFromOptions(options);
      const file = options['eas-json'] || 'eas.json';
      let easConfig;
      try {
        easConfig = JSON.parse(readFile(file));
      } catch (error) {
        throw new CompatibilityError(`Cannot read ${file} (${error.code || error.message}).`);
      }
      const problems = checkProfiles(easConfig, target);
      if (problems.length) {
        for (const problem of problems) stderr(`::error::${problem}\n`);
        return EXIT.failed;
      }
      stdout(`Channel ${target.channel}: profiles ${target.allowedProfiles.join(', ')} build channel ${target.channel} with environment ${target.environment}.\n`);
      return EXIT.ok;
    }
    if (command === 'check') {
      const target = targetFromOptions(options);
      if (!options.fingerprint) throw new CompatibilityError('--fingerprint is required.');
      if (!options['builds-file']) throw new CompatibilityError('--builds-file is required.');
      let raw;
      try {
        raw = readFile(options['builds-file']);
      } catch (error) {
        throw new CompatibilityError(`Cannot read ${options['builds-file']} (${error.code || error.message}).`);
      }
      const builds = parseBuildList(raw);
      const { compatible, rejected } = findCompatibleBuilds(builds, {
        fingerprint: options.fingerprint,
        channel: target.channel,
        allowedProfiles: target.allowedProfiles,
      });
      stdout(`Required: finished Android build, fingerprint and runtime ${options.fingerprint}, channel ${target.channel}, profile ${target.allowedProfiles.join(' or ')}.\n`);
      for (const { build, reasons } of rejected) stdout(`Rejected ${describeBuild(build)}: ${reasons.join('; ')}\n`);
      const limit = Number(options.limit);
      if (Number.isInteger(limit) && limit > 0 && builds.length >= limit && compatible.length === 0) {
        stdout(`Warning: the lookup returned the maximum of ${limit} builds; older builds were not examined.\n`);
      }
      if (compatible.length === 0) {
        stderr(`::error::No finished Android build on channel ${target.channel} from profile ${target.allowedProfiles.join(' or ')} matches fingerprint ${options.fingerprint}.\n`);
        return EXIT.failed;
      }
      for (const build of compatible) stdout(`Compatible ${describeBuild(build)}\n`);
      stdout(`Found ${compatible.length} compatible build(s) for channel ${target.channel}.\n`);
      return EXIT.ok;
    }
    throw new CompatibilityError(`Unknown command "${command || ''}". Use target, profiles or check.`);
  } catch (error) {
    if (!(error instanceof CompatibilityError)) throw error;
    stderr(`::error::${error.message}\n`);
    return EXIT.usage;
  }
}

module.exports = {
  EXIT,
  PUBLISH_TARGETS,
  CompatibilityError,
  checkProfiles,
  describeBuild,
  evaluateBuild,
  findCompatibleBuilds,
  parseArgs,
  parseBuildList,
  resolveProfile,
  run,
  targetForBranch,
  targetForChannel,
};

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2), {
    readFile: (file) => fs.readFileSync(file, 'utf8'),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}
