# SpendWise

SpendWise is an offline-first personal finance app for Android, iOS, and web. It tracks expenses and income, monthly budgets, recurring payments, and reports. **RxDB is the only application-level local database.** When you sign in, a sync queue uploads changes to your own Supabase PostgreSQL project and downloads updates from other devices.

The UI talks to Zustand stores. Stores call repositories and services. Repositories write RxDB first, then enqueue work for Supabase. The UI never calls `supabase.from(...)` directly.

```text
React Native / Expo / Web
        ↓
     UI Layer
        ↓
   Zustand Stores
        ↓
 Repository / Service Layer
        ↓
        RxDB
   ┌────┴────┐
 Android    Web
        ↓
 Supabase Sync Layer
        ↓
 Supabase PostgreSQL
```

## Features

- Home dashboard with live balance, income/expense comparison, monthly budget progress, 7-day chart, top categories, and recent transactions
- Full transaction CRUD with search, filters, sorting, pagination, and date grouping
- Monthly overall and category budgets with 50/75/90/100% visual warnings
- Reports calculated from RxDB-backed repositories: category donut chart, spending trend, income vs expenses, averages, and highest expense
- Recurring transactions (daily, weekly, monthly, yearly) with duplicate-safe generation
- Custom categories with reassignment before delete
- CSV export/import and validated JSON backup/restore (both work offline)
- First-launch onboarding, currency selection, and system/light/dark themes
- Email/password authentication, password reset, and optional offline use
- Subtle sync status, last-synced time, and a manual **Sync now** action in Settings → Account
- Optional development sample data

## Technology stack

- React Native + Expo SDK 57
- TypeScript
- Expo Router
- Zustand
- RxDB 17 (local cache and offline source)
  - Web: Dexie RxStorage (IndexedDB used only inside RxDB)
  - Android / Expo Go: official LocalStorage RxStorage backed by `expo-file-system` (no SQLite, no extra native modules)
  - Tests: in-memory RxStorage
- Supabase Auth + PostgreSQL (cloud source of truth)
- `@react-native-community/netinfo`
- React Hook Form + Zod
- date-fns

## Folder structure

```text
app/                   Screens and Expo Router navigation
  (auth)/              Welcome, sign up, login, forgot password
  (tabs)/              Home, transactions, budgets, reports, settings
components/            Reusable UI, cards, charts, forms
database/              RxDB init, schemas, repositories, seed
store/                 Zustand stores
services/              Business logic, auth, sync, backup, CSV
  supabase.ts          Supabase client
  supabase/            Remote mappers and API (never used by UI)
hooks/                 Theme, reports, network status
utils/                 Currency, dates, calculations, sync logic
supabase/migrations/   Reproducible PostgreSQL schema
__tests__/             Unit tests
```

## Installation

```bash
npm install
cp .env.example .env
npx expo start
```

Then press `a` for Android or `i` for iOS. The app remains usable with empty Supabase env values; cloud auth and sync stay disabled until you configure a project.

```bash
npx expo start --android
npx expo start --ios
```

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open **Project Settings → API**.
3. Copy the project URL and the **anon / publishable** key.
4. Put them in `.env` (never commit the real file):

```text
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

5. Apply SQL migrations from `supabase/migrations/` in order:
   - `001_initial_schema.sql` — tables, indexes, system category catalog
   - `002_rls_policies.sql` — row level security
   - `003_triggers.sql` — `updated_at`, new-user profile, realtime publication
   - `004_constraints.sql` — uniqueness and extra indexes

   With the Supabase CLI:

   ```bash
   supabase db push
   ```

   Or paste each file into the SQL editor for a new project.

6. Enable **Email** authentication in Authentication → Providers. Confirm whether new users must verify email before a session is created.
7. Under **Authentication → URL Configuration**, add these redirect URLs:
   - `spendwise://reset-password`
   - `exp://127.0.0.1:8081/--/reset-password` (local Expo Go, optional)
8. Start Expo: `npx expo start`.

Password-reset emails use `spendwise://reset-password`. Completing the new-password screen inside Expo Go depends on that deep link opening the app. If you only open the link in a browser, the token will not return to SpendWise.

Never put `SUPABASE_SERVICE_ROLE_KEY` in the mobile app or `.env`. That key bypasses RLS and must stay on a server you control.

## Row level security

Every user-owned table has RLS enabled. Policies require `auth.uid() = user_id` (profiles use `auth.uid() = id`). Clients cannot read or write another user's rows. System categories are readable by signed-in users and are not writable from the client.

Default categories are not global mutable rows. Each device seeds local defaults; the first sign-in uploads that user's copies. After a pull from another device, unused local default copies with different IDs are hidden so they do not duplicate the cloud set.

## Offline architecture

RxDB is the local cache and the source for every screen. Supabase is the cloud source of truth.

- **Online**: save RxDB → update UI → queue → upload.
- **Offline**: the same path, without upload. The user sees **Saved offline**, not an error.
- **Reconnect**: NetInfo triggers `performFullSync()`.
- **App start**: restore the Supabase session, open RxDB, show local data immediately, then sync in the background.
- **First login on a new device**: authenticate, claim any unassigned local rows, download the user's cloud data, then open the app. Login shows a downloading state so the dashboard is not empty mid-sync.

The local `sync_queue` stores `create` / `update` / `delete` operations. Duplicate work for the same entity is coalesced (create+update stays a create; create+delete is dropped; update+delete becomes a delete). Failed network operations retry up to three times with exponential backoff and remain in the queue.

Auth sessions persist in AsyncStorage (SecureStore's 2 KB limit is too small for Supabase session JSON).

## Conflict resolution

Last-write-wins on `updated_at`.

- Same primary key on both sides: keep the record with the newer ISO timestamp.
- Soft deletes (`deleted_at`) use the same rule, so a later delete does not reappear after sync.
- Equal timestamps keep the local copy while a push is in flight.
- Upserts never insert a second row for an existing id.

Existing local data is not deleted when a sync request fails.

## Local database

RxDB collections: transactions, categories, accounts, budgets, recurring, settings, sync_queue, sync_state. Schema version 0. Soft deletes use `deletedAt`. Unassigned local rows use an empty `userId` until claim-on-login.

If this device still has the previous JSON snapshot (`spendwise.local.v1` in AsyncStorage), it is imported into RxDB once and then removed. There is no production SQLite database in the current tree to migrate. Signed-in users can also refill from Supabase.

Money is stored as integer minor units (`₹450.50` → `45050`).

After logout, cached rows stay on the device but remain scoped to the last account so a second sign-in cannot see them. JSON backup/restore and CSV import/export continue to work offline.

## Development commands

```bash
npm start            # Expo dev server
npm run android      # Open Android
npm run ios          # Open iOS
npm run web          # Web (RxDB + Dexie)
npm test             # Unit tests
npm run typecheck    # TypeScript check
```

## Testing

```bash
npm test
npx tsc --noEmit
```

Tests cover balance/income/expense math, budget usage, category aggregation, date filtering, recurring date advancement, currency conversion, backup validation, last-write-wins conflicts, sync-queue coalescing, retry backoff, auth error mapping, and local user isolation.

These tests do not call a live Supabase project. Configure `.env` and exercise sign-in, offline edits, and **Sync now** on a device before treating cloud sync as verified.

## Build instructions

```bash
npx expo prebuild
npx expo run:android
npx expo run:ios
```

Or create store builds with EAS after adding an `eas.json` for your account.

## Troubleshooting

- **Cloud sync is not configured**: fill `.env` from `.env.example` and restart Expo.
- **Database failed to open**: force-close the app and relaunch. The first launch creates the RxDB database and seeds default categories.
- **Blank dashboard**: add a transaction or load sample data from Settings → Backup & restore.
- **Restore rejected**: only version 1 SpendWise JSON backups are accepted, and the file is validated before any overwrite.
- **Export/share unavailable**: the OS share sheet must be available; this is expected on some web previews.
- **Web preview**: use `npx expo start --web`. Deep links need the current origin allowlisted in Supabase Auth.
- **Type errors after install**: run `npx expo install --fix` to align Expo package versions.

## Privacy

SpendWise stores application data in RxDB first. If you sign in, your data syncs only to the Supabase project whose URL and anon key you configured. Local JSON backups and CSV files are created only when you export them. The service-role key is never shipped in the app.

Supabase Auth sessions still persist with AsyncStorage because SecureStore cannot hold the session JSON. That is auth session storage, not the application database.
