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

### Sync cursor migrations (008, 009)

Apply in order in the Supabase SQL editor. `009_harden_sync_server_time_permissions.sql` revokes and grants on the function created by `008_server_sync_cursor.sql`, so `009` fails if `008` is missing. The app keeps the legacy `updated_at` pull when `sync_server_time()` does not exist, so these can be applied before or after a compatible OTA.

Order: `008` first, then `009`. Never edit `008` (a test pins its SHA-256) and never add a second `009`.

Manual checks after applying `009` (SQL editor):

```sql
-- 008 columns: expect 6 rows, timestamp with time zone, is_nullable = NO.
select table_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and column_name = 'server_updated_at'
  and table_name in ('transactions', 'categories', 'budgets', 'recurring_transactions', 'accounts', 'investments')
order by table_name;

-- 008 triggers: expect 6 rows, BEFORE INSERT OR UPDATE, function set_server_updated_at.
select c.relname as table_name, t.tgname as trigger_name, p.proname as function_name,
       pg_get_triggerdef(t.oid) as definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where n.nspname = 'public' and not t.tgisinternal and t.tgname = c.relname || '_set_server_updated_at'
order by c.relname;

-- 008 indexes: expect 6 rows, each on (user_id, server_updated_at).
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public' and indexname = 'idx_' || tablename || '_user_server_updated'
order by tablename;

-- Function signature and ACL: expect exactly one row, sync_server_time(), returns
-- timestamp with time zone, provolatile = v, prosecdef = false. proacl must contain
-- authenticated=X/..., and must not contain anon=X/... or a PUBLIC entry (one starting with =X/).
select p.oid::regprocedure as signature, pg_get_function_result(p.oid) as returns,
       p.provolatile, p.prosecdef, p.proacl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'sync_server_time';

-- 009 permission boundary: expect authenticated = true, anon = false, public = false.
select
  has_function_privilege('authenticated', 'public.sync_server_time()', 'execute') as authenticated,
  has_function_privilege('anon', 'public.sync_server_time()', 'execute') as anon,
  exists (
    select 1 from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'sync_server_time' and grantee = 'PUBLIC'
  ) as public;

-- Server timestamp is a valid value close to now().
select public.sync_server_time() as server_time, abs(extract(epoch from public.sync_server_time() - now())) < 5 as near_now;
```

From the client (anon key): `supabase.rpc('sync_server_time')` without a session must fail with a permission error (`42501`); after signing in it must return a timestamp. A `PGRST202` error means `008` is not deployed. The app treats only `PGRST202` as "not deployed" (legacy pull); a permission error or an unparseable value fails the sync instead of silently falling back.

### Pull cursor limits and recovery

- Incremental pulls re-read rows stamped up to 60 seconds before the stored cursor. A server write whose transaction commits more than 60 seconds after its `server_updated_at` stamp can be missed by incremental pulls. It is picked up by the next full pull.
- A full pull runs when the account has no stored cursor on the device, the stored cursor or full-pull stamp is unreadable, either stamp is ahead of the server clock, or 24 hours have passed since the last full pull. A full pull then stores the current server time.
- Server timestamps are parsed explicitly (microseconds and `+00:00` offsets included) and stored as ISO-8601 UTC; a value that cannot be parsed is never stored as a cursor.
- There is no manual "full resync" control. Signing in to an account for the first time on a device starts with a full pull.

### Sync smoke tests (physical devices)

Not performed by repository setup or CI. Use two Android devices on a compatible preview update, with `008` and `009` applied.

Recurring occurrence across two devices (same account):

1. Create a recurring rule due today on device A while online and let it sync.
2. On device B, go offline, open the app so it generates the same occurrence locally.
3. On device A, edit that occurrence (for example the amount) and let it sync.
4. Bring device B online and sync. Expect A's edit on B, a single occurrence (no duplicate), and an empty pending queue.
5. Repeat with B editing its own copy after step 3 while still offline, then going online: B's later edit wins on both devices.
6. Delete the occurrence on A, sync, then sync B with an untouched copy: it disappears on B and is not regenerated.
7. On a device, after the first sync completes, a second sync should log `starting pull (incremental, server_updated_at)`. If every sync logs `full`, the device is not reading the stored cursor.

Account switching (one device):

1. Sign in as account A and sync. Sign out.
2. While signed out, create a transaction. Sign in as account B: that transaction belongs to B, uploads to B (check `transactions` filtered by B's `user_id` in Supabase), and none of A's rows appear in B.
3. Queue many changes in A (for example offline), go online and sign out then into B while the sync is running. No A rows may be written under B's `user_id`, and B finishes with its own full sync.
4. Sign back in as A: A's data is intact, and anything A still had pending uploads under A.

## Physical APK verification

This is the device checklist. It is not performed by repository setup.

1. Install an update-enabled `preview` APK.
2. Create a transaction while offline.
3. Publish a harmless preview UI change from `development`.
4. Open the app, wait for **Update ready**, and restart.
5. Confirm the UI change.
6. Confirm the offline transaction and pending sync queue are intact.
7. Force-quit, disable network, and relaunch successfully on the downloaded update.
