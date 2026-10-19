# Phase 3 — Edge Function decision log

Branch: `feature/ai-finance-assistant` (from `8937dd7`)  
Scope: secure, provider-neutral Supabase Edge Function foundation only.  
Not in scope: UI, deploy, paid provider SDK, migrations, OTA, APK, SMS/notification capture.

## Decisions

| # | Decision | Evidence / rationale | Alternatives rejected |
| --- | --- | --- | --- |
| D1 | Single function `financial-assistant` with `capability` routing | AI spec E1–E4; smaller auth/CORS surface than three public endpoints | One function per capability |
| D2 | Provider stays unresolved; ship `FinancialAiProvider` + `UnavailableFinancialAiProvider` | Spec K2; user Phase 3 prompt; no paid calls / no deploy | Hard-coding OpenAI/Anthropic/Gemini |
| D3 | `monthly_summary` / `budget_suggestions` accept only `AiSafeFinancialSnapshot` (`kind: 'ai_safe'`) | Phase 2 contract; local snapshot must never be an AI envelope | Reusing Phase 1 illustrative E2/E3 payload shapes as the wire format |
| D4 | `categorize_merchant` uses a separate minimal redacted payload (never raw tx / SMS / ledger) | Spec E4 + D3/D4; Phase 3 prompt | Accepting full transaction objects |
| D5 | Auth: require user JWT (`verify_jwt = true` + `auth.getUser`); reject anon-only | Spec D1/G; RELEASE.md — provider secrets server-side; cloud AI needs signed-in session | Open/public invoke; service-role from client |
| D6 | Pure validation/handler modules are Deno-import-free so Jest can unit-test without Docker | Existing repo uses Jest/ts-jest; no Edge Function tests exist today | Deno-only tests requiring `supabase functions serve` |
| D7 | Keep function under `supabase/functions/` (force-add; `.gitignore` has `supabase`) | Matches Supabase layout and tracked migrations precedent; do not rewrite `.gitignore` in this phase | Moving code only under `services/` (non-standard for deploy later) |
| D8 | Minimal `supabase/config.toml` with only `[functions.financial-assistant] verify_jwt = true` | No `config.toml` exists today; avoid inventing full `supabase init` defaults | Full generated config dump |
| D9 | Best-effort in-memory rate limit per `userId` (documented non-durable) | Cost / abuse control foundation; durable Redis/DB later | No limit; inventing a new DB table/migration |
| D10 | Env: `FINANCIAL_AI_PROVIDER=unavailable` (default); provider secrets never `EXPO_PUBLIC_*` | Spec D1.5 / RELEASE.md | Client-held provider keys |
| D11 | No response persistence / minimal log fields (`requestId`, capability, error code, user id hash optional) | Spec K2 retention unresolved — fail closed to minimal | Logging full AI payloads |
| D12 | No client invoke module / UI wiring in Phase 3 | Explicit Phase 3 scope | Early Expo service that encourages accidental Local snapshot upload |
| D13 | Strict allowlisted AiSafe snapshot parse (no untrusted object spread) | Corrective: unknown fields / unsafe integers must not reach providers | Partial validation + `...(snap as …)` |
| D14 | Model output: reject invalid confidence, oversized text, bad kinds/IDs (no clamp/truncate) | Fail closed — clamping creates a false “valid” response | Soft repair of provider JSON |
| D15 | Budget results require `requiresConfirmation: true` | Recommendations must never look auto-applicable | Omitting confirmation semantics |
| D16 | Invented categorize IDs → `invalid_model_output` (no silent drop) | Silent filter hid model invention | Drop-and-continue |
| D17 | Hard provider timeout (`PROVIDER_TIMEOUT_MS`) | Cost / hang control | Unbounded await |
| D18 | CORS allowlist via `FINANCIAL_AI_CORS_ORIGINS` — never `*` | Browser origin reflection only; not a substitute for JWT auth | `Access-Control-Allow-Origin: *` |
| D19 | `405` unsupported method; `415` non-JSON content type; reject future timestamps | Corrective request hygiene | `400` for all / accepting future clocks |
| D20 | Tests use synthetic three-segment bearer, not JWT-shaped fixtures | Avoid secret-scanner false positives | `eyJ…` fixture strings |

## Threat notes

- Credentials: only Edge secrets / platform `SUPABASE_*`; never shipped in Expo public env.
- Privacy: reject `kind: 'local'`, prohibited keys, unknown snapshot fields, oversized bodies (>8 KiB req / >16 KiB res).
- Portability: all model I/O goes through `FinancialAiProvider`; swapping providers is a new implementation class only.
- CORS allowlisting is not authentication; JWT remains mandatory.
