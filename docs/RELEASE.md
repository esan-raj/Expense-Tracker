# SpendWise Android release and EAS Update

SpendWise is distributed as a signed Android APK. Compatible JavaScript and asset changes can reach an already-installed APK through EAS Update. Native changes require a new APK. This guide uses the profiles, Git branches, and EAS channels that exist in this repository.

Git branches and EAS Update channels are different:

| Concept | Names in this project | Purpose |
| --- | --- | --- |
| Git branch | `development`, `Production` (`main` is preserved) | Source control and GitHub Actions triggers |
| EAS Update channel | `preview`, `production` | Which installed APKs may download a published JS update |
| EAS environment | `preview`, `production` | Which `EXPO_PUBLIC_SUPABASE_*` values are baked into that update |
| EAS build profile | `preview`, `production-apk`, `production` | How the native binary is built and which channel is baked in |

A preview APK (`eas.json` profile `preview`) is built with channel `preview` and only receives preview updates. A production APK (`production-apk`) or store AAB (`production`) is built with channel `production` and only receives production updates. An existing APK baked for another channel will not pick up the other track; install a replacement APK built with the matching profile and the same package/signing identity.

Do not treat an over-the-air publication as a database, RxDB schema, or Supabase/RLS migration. Those remain explicit, separate responsibilities.

## Mapping

| Track | Git branch (exact name) | Trigger | EAS Update channel | EAS environment | Android build profile |
| --- | --- | --- | --- | --- | --- |
| Preview | `development` | Push to `development` | `preview` | `preview` | `preview` (internal APK) |
| Production review | PR `development` → `Production` | Pull request | none | none | none (validation + `release-source` only) |
| Production | `Production` | Push after that PR merges | `production` | `production` | `production-apk` (internal APK) or `production` (store AAB) |

`main` is kept. It is not an OTA publish branch.

Runtime compatibility uses Expo’s fingerprint policy:

```json
"runtimeVersion": { "policy": "fingerprint" }
```

An update is served only to binaries whose native fingerprint matches. JavaScript that depends on new native code, permissions, SDK upgrades, launcher icons, or native splash configuration will not load in an older APK.

## Required Expo and GitHub setup

These are external steps. This repository does not store `EXPO_TOKEN`, service-role keys, or other secrets.

1. Sign in to the existing Expo project `spendwise` (`ae5c50a4-286f-4770-8d9c-8f3d83d87d02`).
2. Confirm Android package `com.spendwise.app` and reuse the existing EAS Android keystore/signing identity.
3. In Expo → Environment variables, create environments named `preview` and `production`.
4. In **both** environments set only:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
5. Do not put `SUPABASE_SERVICE_ROLE_KEY`, Expo tokens, or other secrets in client env vars.
6. Create a GitHub Actions secret named `EXPO_TOKEN` from [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens). Pull-request jobs never receive this secret.
7. Keep GitHub Actions permissions at repository defaults plus workflow `contents: read`.

Local `.env` remains for Metro/web development. Release APKs and OTA bundles read the matching EAS environment at build/publish time.

## First update-enabled APK

Install a preview APK before publishing OTA. The installed binary must include `expo-updates`, the fingerprint runtime, and channel `preview`.

```bash
npx eas-cli@latest build --profile preview --platform android
```

Install the APK from the EAS build page. Create a production-channel APK only when you are ready to ship that track:

```bash
npx eas-cli@latest build --profile production-apk --platform android
```

Store / Play uploads use the existing AAB profile:

```bash
npx eas-cli@latest build --profile production --platform android
```

`production` and `production-apk` inherit `autoIncrement` so EAS assigns a higher Android version code. Keep the same package name and signing key.

## Publish a compatible update

GitHub:

- Push to `development` → `validate`, then publish to EAS channel `preview` with environment `preview` if a finished Android build matches the current fingerprint.
- Open a pull request from `development` into `Production` → `validate` and `release-source` only. No OTA publish on the pull-request event.
- Merge that PR → push to `Production` → `validate`, then publish to EAS channel `production` with environment `production` if the fingerprint has a finished Android build.

Publication waits for `validate` (TypeScript and Jest) on the same git SHA. The publish job then takes a per-channel lock (`cancel-in-progress: false`). It generates the Android fingerprint with the matching EAS build profile (which binds the same EAS environment later passed to `eas update`), looks up a finished Android build for that fingerprint, then re-checks that SHA is still the branch tip immediately before `eas update`. Fingerprint CLI stdout is captured to a file so stderr stays visible; a missing `eas.json` profile, a fingerprint parse error, or no matching APK fails the job without claiming installed APKs received the change. Older queued commits are skipped instead of publishing over a newer release. In-flight production publishes are not cancelled. The update message is `sha:<commit>`.

Manual (after `npx tsc --noEmit` and `npx jest --no-coverage`):

```bash
npx eas-cli@latest update --channel preview --environment preview --platform android --message "sha:$(git rev-parse HEAD)"
npx eas-cli@latest update --channel production --environment production --platform android --message "sha:$(git rev-parse HEAD)"
```

npm helpers (still require EAS login):

```bash
npm run update:preview
npm run update:production
```

Always pass `--environment` so `EXPO_PUBLIC_SUPABASE_*` come from the matching EAS environment, not from a developer laptop.

## GitHub required checks and Production protection

Required status-check names (exact):

- `validate`
- `release-source`

### Bootstrap sequence

Do not enable “required status checks” until those names have actually run once. GitHub cannot require a check that has never appeared.

1. Commit the workflow files on `development` (not on `Production`).
2. Open a pull request from `development` into `Production`. GitHub runs `validate` and `release-source` from the PR head.
3. After both checks have completed on that PR, turn on branch protection / ruleset required checks using the names above.
4. Merge only after the checks pass.

### Production rules (manual GitHub settings)

GitHub → Settings → Rules → Rulesets → New branch ruleset (preferred), targeting `Production`:

- Require a pull request before merging.
- Require status checks to pass: `validate`, `release-source`.
- Require conversation resolution before merging.
- Block force pushes.
- Block deletions.
- Do not allow bypass for administrators in routine use (leave the bypass list empty, or empty except a break-glass account you never use day to day).
- Restrict who can update the branch / merge PRs to the owner or designated release maintainers if the repository plan includes ruleset bypass and merge restrictions.

If an independent reviewer exists: require 1 approval and dismiss stale reviews.

If the owner is the only contributor: they cannot approve their own pull request. Use required PRs plus passing `validate` and `release-source`, with **zero required approvals**, still blocking direct pushes, force-pushes, and deletion. That keeps Production merge-only without a second person.

Do not require a check that has never run.

This repository setup does not change remote protection settings automatically.

## When users see an update

1. The installed APK checks in the background after local RxDB bootstrap. Startup is not blocked.
2. Offline launch uses the embedded bundle or a previously downloaded compatible update.
3. After a download, SpendWise shows **Update ready** with **Restart now** or **Later**.
4. Settings → App updates can check manually. States are checking, downloading, ready, unavailable, and error.
5. Restart is refused while a transaction form, import/restore, or other critical mutation is in progress.
6. Before reload, SpendWise flushes native persistence. If the flush fails, the current session keeps running and the error is retryable.
7. Cloud sync does not need to finish. Unsynced outbox operations remain queued in RxDB.

Expo Go, Metro development sessions, and web do not receive APK OTA updates.

## Changes that require a new APK

Build and install a new APK (same package and signing identity, new version code) when you change:

- Native dependencies or config plugins
- Android permissions
- Expo SDK version
- Launcher icon or adaptive icon
- Native splash image/background
- `runtimeVersion` / fingerprint inputs (native project files, autolinking, app config that affects native)

The GitHub publish job reports this when `eas fingerprint:generate` does not match a finished Android build. Users on an older native runtime will not receive that JavaScript.

Replacement APK commands:

```bash
npx eas-cli@latest build --profile preview --platform android
npx eas-cli@latest build --profile production-apk --platform android
```

Users install the new APK over the old one. Local RxDB data is not wiped by an update or by a same-package APK upgrade.

## Republish a previous compatible update

```bash
npx eas-cli@latest update:republish --channel preview --non-interactive
npx eas-cli@latest update:republish --channel production --non-interactive
```

Add `--group <update-group-id>` to republish a specific group. Republishing cannot apply an update whose fingerprint/runtime does not match the installed APK.

## Data and migrations

- RxDB remains the local source of truth. Updates must not reset or replace the local database to “make OTA work.”
- Future RxDB schema changes need a schema version bump and a migration. Ship that only with a compatible JS update, and only after the migration is written.
- Supabase SQL/RLS migrations are a separate deployment. Publishing OTA does not apply them.
- Rolling back JavaScript does **not** reverse RxDB or Supabase migrations. If a schema migration already ran on a device, republishing older JS can break that device until you ship forward-compatible code.

## Physical APK verification

This is the device checklist. It is not performed by repository setup.

1. Install an update-enabled `preview` APK.
2. Create a transaction while offline.
3. Publish a harmless preview UI change from `development`.
4. Open the app, wait for **Update ready**, and restart.
5. Confirm the UI change.
6. Confirm the offline transaction and pending sync queue are intact.
7. Force-quit, disable network, and relaunch successfully on the downloaded update.
