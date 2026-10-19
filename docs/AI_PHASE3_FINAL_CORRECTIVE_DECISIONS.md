# Phase 3 final corrective — decision log

Starting tip: `e4a8e5a` on `feature/ai-finance-assistant`  
Protected: `development` (`d695057`), `Production` (`6ef8a80`), `main` (`74a3fac`)

## Required changes (evidence → decision)

| ID | Change | Evidence | Behaviour change | Impact | Smaller alternative rejected |
| --- | --- | --- | --- | --- | --- |
| A1 | Cooperative `AbortSignal` + deadline on provider calls; abort on timeout; swallow late settle | `timeout.ts` only races promises; provider timers remain (Jest open-handle) | Timeout aborts signal; late resolve/reject cannot alter response | Security/cost: stops waiting work cooperatively; not a hard thread kill | Claiming JS can forcibly kill sync work |
| A2 | Document adapters must pass `signal` to `fetch` | Provider contract incomplete | Future adapters fail review without signal | Portability | Silent assumption |
| B1 | Reject disallowed `Origin` with **403** `origin_not_allowed` **before** auth/parse/provider | CORS omitted ACAO but still ran handler | Disallowed browsers never reach provider | Privacy/cost | Only omitting ACAO (false security) |
| B2 | Empty/malformed allowlist: no `*`; browser origins rejected; originless native OK | Spec requirement | Fail closed for browsers when misconfigured | Ops must set allowlist for web | Reflecting arbitrary Origin |
| C1 | Per-request `consent: { cloudAi: true, policyVersion: 1 }` | Phase 1: cloud AI opt-in; no wire consent today | Missing/false/unknown/unsupported version → reject before provider | Privacy; no DB storage this phase | Inventing settings migration / UI |
| D1 | Reject duplicate category IDs; stable sort (confidence desc, `categoryId` asc) | Silent drop/repair forbidden | Nondeterministic/duplicate model output → `invalid_model_output` | Integrity | Soft de-dupe |
| E1 | Fix open handles via abort + timer clear + consumed late promises | `--detectOpenHandles` / “Jest did not exit” | Suite exits cleanly | CI reliability | `--forceExit` / `unref` |
| E2 | `createAppStartupController.dispose()` clears OTA force-ready timer; reloading test calls dispose | Full-suite `--detectOpenHandles` pointed at `appStartup.ts:189` | Test teardown no longer leaks a 30s timer | Test hygiene only; production OTA fallback unchanged until dispose | `--forceExit` |

## Consent vs Phase 1 doc

Phase 1 proposes persistent `aiAssistantEnabled` (settings UI — later). This commit adds **per-request consent** on the Edge envelope so the server never calls a provider without an explicit `cloudAi: true` in the same JSON body. Persistent opt-in storage remains a later client phase. No conflict: request consent is the server gate; settings UI is the client gate.

## Rate-limit deployment boundary (unchanged mechanism)

In-memory limiter stays **best-effort / non-durable**. **Production deploy of this function is blocked** until durable per-user rate limiting and provider budget controls are designed. Multiple Edge isolates can bypass in-memory limits. Fail-open vs fail-closed for a future durable limiter remains an explicit undecided product decision.

## Explicitly out of scope

Deploy, real provider, paid calls, APK, OTA, migrations, client/UI integration, DB-backed limiter.
