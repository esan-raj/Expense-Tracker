# Phase 4A — Client boundary decision log

Starting tip: `1efa7ea`  
Protected: `development` `d695057`, `Production` `6ef8a80`, `main` `74a3fac`

## Decisions

| ID | Decision | Evidence | Rejected alternative |
| --- | --- | --- | --- |
| D1 | Store consent on RxDB **settings** doc (device-local): `aiCloudEnabled`, `aiConsentPolicyVersion`, `aiConsentAcceptedAt` | Accent fields already live on settings without Supabase profile columns; pull only patches currency/theme/budget/onboarding | AsyncStorage/MMKV; second DB; syncing to `profiles` |
| D2 | Schema **v1→v2** migration defaults all existing users to **disabled** (`aiCloudEnabled: false`, policy `0`) | Phase 4A: never enable via migration | Shipping fields without migration (RxDB would reject) |
| D3 | Consent writes use `settingsRepository.update` **without** `queueChange('profile')` | Outbox payload would otherwise carry consent; remote ignores unknown columns but local-only path is clearer | Routing consent through `useSettingsStore.update` (always queues) |
| D4 | Per-request Edge consent still `{ cloudAi: true, policyVersion: 1 }` only when local consent active | Phase 3 contract | Inventing a second wire shape |
| D5 | Pure `redactFinancialText` module; omit field if unsafe after redaction | Phase 1 D4; adversarial tests | Logging originals; partial digit leakage |
| D6 | Request builders allowlist-construct envelopes; reject >8 KiB UTF-8 | Phase 3 limits | Silent truncation |
| D7 | `invokeFinancialAssistant` via injected `supabase.functions.invoke` + session/consent recheck; fakes in tests | No live Edge deploy; no second Supabase client | Calling production functions in CI |
| D8 | Privacy screen: disclosure + ConfirmDialog enable + Switch disable | Existing `ConfirmDialog` / privacy route | Full AI dashboard / chatbot |
| D9 | No automatic invoke on launch/login/sync/render | Explicit Phase 4A scope | Background refresh |

## Fingerprint

Pre-change Android fingerprint: `e44eef6d3be3b5ece96b4141a9cfd6e317f7c4b8`  
Post-change Android fingerprint: `e44eef6d3be3b5ece96b4141a9cfd6e317f7c4b8` (**unchanged**)  
New preview APK **not** required for later JS OTA of this work.

## Out of scope

Deploy, paid provider, OTA, APK, SQL migrations, PR to development/Production/main.

## Rejected / deferred

| Idea | Why rejected |
| --- | --- |
| Sync AI consent via profiles | No profile columns; device-local preferred; pull would not round-trip safely |
| AsyncStorage / MMKV consent store | Violates RxDB-only app storage abstraction |
| Full AI assistant screen / chatbot | Phase 4A is boundary-only |
| Live Edge calls in Jest | Function not deployed; DI fakes only |
| Auto-retry on auth/consent/rate-limit | Fail closed; no automatic retry this phase |
| Persist AI responses | No safe durable store required yet |
