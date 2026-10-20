# SpendWise AI Financial Assistant — Phase 1 scope

Status: **Phase 1 scope + Phase 2 local analytics (corrective)** — no AI network yet
Branch base: `origin/development` (`d695057`) via `feature/ai-finance-assistant`
Audience: product, privacy, RN client, Supabase backend, QA
Related docs: [RELEASE.md](./RELEASE.md), in-app Privacy (`app/settings/privacy.tsx`)

This document defines the **first AI release scope**. It does not authorize dependencies, Edge Functions, RxDB/Supabase migrations, native modules, OTA, or UI work. Those belong to Phase 2+ after this document is approved.

---

## 0. Repository facts this scope must respect

Verified against the current codebase (do not invent fields):

| Area | What exists today |
| --- | --- |
| Architecture | UI → Zustand stores → repositories/services → **RxDB first**; Supabase sync is a separate queue (`README.md`) |
| Money | Integer **minor units** on `Transaction.amount`, `Budget.amount`, `Settings.monthlyBudget` |
| Transactions | `type` (`expense` \| `income`), `title`, `description`, `notes`, `date` (`YYYY-MM-DD`), `categoryId`, `accountId`, `paymentMethod`, transfer flags — **no dedicated `merchant` column** |
| “Merchant” for AI | **Mapped to redacted `title`** (and optionally a short `description` that may leave the device **only after deterministic PII redaction** — see D2/D4). Proposed rename/field is out of scope |
| Categories | User + default categories with `name`, `icon`, `color`, `type` |
| Budgets | Per-category budgets (`categoryId`) and overall budget via two existing sources; **analytics canonical = null-`categoryId` row**, fallback `settings.monthlyBudget` (see K1) |
| Reports | Deterministic `reportService.dashboard` / `reportService.analytics` + `utils/calculations.ts` |
| Privacy copy | Local RxDB first; optional sync to the user’s Supabase project; **no analytics/ads SDKs**; export/backup only on demand |
| AI / SMS / notifications | **None** in the app today — no provider SDK, no notification listener, no SMS reader |
| Auth | Supabase Auth; signed-out offline use is supported |

Anything labelled **Proposed** below does not exist yet.

---

## A. First three capabilities

### A1. Monthly spending summary

**User value:** A short, trustworthy narrative of one calendar month’s cash flow.

**Deterministic inputs (client TypeScript, reuse existing analytics):**

- Period: `{ month, year }` (same convention as `reportService.dashboard`)
- Totals: income, expenses, net, savings rate, average daily spend (from `reportService.analytics` / `utils/calculations`)
- Category breakdown: top N expense categories with amounts and percents (exclude transfers via existing `isTransfer` / `excludeTransfers` rules)
- Budget usage: overall monthly budget + category budgets with `calculateBudgetUsage` / warning levels (50/75/90/100)
- Prior-period comparison when previous month has data (`previousIncome` / `previousExpenses` already computed on the dashboard path)

**AI role:** Explain the pre-computed snapshot in plain language; highlight 1–3 notable patterns; suggest optional next steps (never mutate data).

**AI must not:** Recompute or invent totals, invent categories, or claim transfers are expenses.

### A2. Budget recommendations

**User value:** Suggested overall and/or category budget amounts for a target month, grounded in recent spending.

**Deterministic inputs:**

- Lookback window of completed months (default: last 3 months with ≥1 expense day; exact window computed in TS)
- Per-category average / median spend (TS)
- Current overall budget (`settings.monthlyBudget`) and category budgets for the target month
- Currency code + minor-unit scale from settings (for display only; wire amounts stay integers)

**AI role:** Propose recommended amounts and short rationales; flag high-volatility categories as low confidence.

**AI must not:** Write budgets to RxDB/Supabase. Applying a suggestion is always an explicit user confirm that calls existing budget/settings APIs in Phase 2+.

### A3. Unknown merchant categorisation

**User value:** Suggest a category when the user (or import path) has a low-confidence or missing category for an expense.

**Deterministic inputs:**

- Redacted merchant text derived from `title` (required)
- Optional `description`: may leave the device **only after deterministic PII redaction** (D4); then capped at ≤80 characters. Unredacted descriptions are prohibited on the wire
- Candidate category list: `{ id, name, type }` for expense-capable categories only
- Optional signals: `paymentMethod`, amount **bucket** (not exact amount — see privacy), prior category for similar titles if available from local history (computed on-device)

**AI role:** Return ranked category suggestions with confidence.

**AI must not:** Create categories, change the transaction, or run without user confirmation.

---

## B. Explicitly excluded from the first AI release

| Exclusion | Reason |
| --- | --- |
| General-purpose chatbot | Unbounded prompts → privacy leakage, hallucination of numbers, cost spikes |
| Investment, tax, credit, or legal advice | Out of product competence; liability; investments module is separate and must stay AI-free in v1 |
| Automatic transaction modification | Trust: AI suggests, user confirms via existing edit flows |
| Automatic budget creation or changes | Same — suggestions only |
| Reading raw SMS / notifications | Not in the app; high PII; platform permission risk; fingerprint/native impact |
| Sending complete transaction histories to AI | Unnecessary for the three jobs; maximizes breach blast radius |
| Any native notification listener | No native module; would force new APK / fingerprint |
| Multi-turn memory of user finances across sessions | Deferred; v1 is request/response with ephemeral server logs only as required for ops |
| On-device LLM packaging | Deferred; avoids large native binaries and fingerprint churn |

---

## C. Responsibilities split

```text
RxDB (source of truth on device)
        ↓
Deterministic TypeScript (reportService, calculations, budget usage)
        ↓
Redacted AI request envelope (validated, size-capped)
        ↓
[Proposed] Supabase Edge Function → AI provider
        ↓
Validated AI response (schema + figure cross-check)
        ↓
UI: Fact | Interpretation | Suggested action (confirm to apply)
```

| Layer | Responsibility |
| --- | --- |
| Deterministic TS | All totals, trends, projections, budget math, amount buckets, transfer exclusion |
| AI | Natural-language explanation, suggestion text, merchant→category ranking |
| Client validator | Reject AI JSON that invents figures not present in the request snapshot; clamp confidence; enforce enums |
| User | Sole authority to apply category or budget changes |

**Hard rule:** AI must never invent financial figures. Every money amount shown as fact must equal a field from the deterministic snapshot (or be clearly labelled as a *suggestion* with no claim of historical accuracy).

---

## D. Privacy boundary

### D1. Principles

1. Local ledger, reports, budgets, and sync continue to work with **AI disabled** (default).
2. **Cloud AI is separately opt-in** (**Proposed** setting, e.g. `aiAssistantEnabled` + timestamp — not in `settings` schema today).
3. Opt-in is per signed-in user session preference on device; signing out clears in-memory AI state.
4. Minimum necessary data: aggregates and redacted labels, not the full ledger.
5. Provider API keys never ship in the Expo client or EAS public env (`EXPO_PUBLIC_*`). **Proposed:** Supabase Edge Function holds the provider secret (aligns with RELEASE.md rule: no service-role/provider secrets in client env).

### D2. Fields allowed to leave the device (after redaction / aggregation)

| Field | Capability | Notes |
| --- | --- | --- |
| `currency` | all | From settings |
| `period` / `lookbackMonths` | summary, budgets | Calendar metadata only |
| Aggregated totals | summary, budgets | Integers already computed on device |
| Category spend rows `{ categoryId, categoryName, amountMinor, percent }` | summary, budgets | Names are user-chosen labels |
| Budget rows `{ categoryId \| null, amountMinor, spentMinor, percent }` | summary, budgets | |
| Prior-period totals | summary | Aggregates only |
| Redacted merchant label | categorize | From `title` |
| Optional description snippet | categorize | **Only after deterministic PII redaction** (D4), then ≤80 chars. Raw/unredacted `description` must never leave the device |
| Candidate categories `{ id, name }` | categorize | |
| Amount **bucket** only | categorize | e.g. `0–500`, `500–2000`, `2000–10000`, `10000+` minor units — not exact amount |
| `paymentMethod` enum | categorize | No account numbers |
| Locale / timezone offset | all | For wording only |
| Opaque `requestId` / `snapshotId` | all | Client-generated UUIDs for correlation |

### D3. Prohibited from leaving the device (and from provider prompts)

- Raw SMS, notification titles/bodies, email bodies
- Account numbers, IBAN, card numbers, UPI VPA / UPI IDs, IFSC, wallet IDs
- Auth tokens, Supabase keys, Expo tokens, refresh tokens
- Unredacted `title` / `description` / `notes` (descriptions leave the device only after D4 redaction succeeds; if redaction would empty the field, omit it)
- Full transaction lists or CSV/JSON backups
- `userId`, email, display name, device identifiers
- Exact GPS / contacts
- Investment holdings detail for AI v1 (even though the investments module exists)
- Screenshots or attachment binaries

### D4. Redaction rules (client, before any network)

**Hard rule:** `transaction.description` may leave the device **only after** these deterministic PII redaction steps run on-device. The same pipeline applies to `title` before it is used as `merchantLabelRedacted`. There is no path that uploads raw description text.

Apply in order; drop the field if it becomes empty:

1. Mask sequences of ≥6 digits (cards, phones, refs).
2. Mask UPI-like tokens (`user@bank`, `upi://…`).
3. Mask emails and `http(s)://` URLs.
4. Collapse whitespace; truncate merchant label to **80** characters, description snippet to **80**.
5. Never send `notes`.

### D5. Offline and local-only mode

- With AI off or offline: monthly summary UI can still show **deterministic** charts/totals (existing reports). AI narrative is simply unavailable.
- Categorisation without AI: user picks from the existing category list (current behaviour).

---

## E. Provider-neutral contracts (not implemented)

Shared conventions:

- Amounts in **integer minor units** (same as RxDB).
- Dates as `YYYY-MM-DD`; months as `{ month: 1–12, year: 2000–2100 }`.
- JSON only; `Content-Type: application/json`.
- Max request body **8 KiB**; max response body **16 KiB**.
- `schemaVersion: 1` on every payload.
- Server (**Proposed** Edge Function) rejects oversized or unknown keys (`additionalProperties` false).

### E1. Common envelope

```ts
/** Client → Edge Function (Proposed) */
type AiAssistantRequest<T extends string, P> = {
  schemaVersion: 1;
  requestId: string;           // uuid
  capability: T;
  snapshotId: string;          // uuid of deterministic snapshot
  snapshotComputedAt: string;  // ISO-8601
  locale: string;              // e.g. "en-IN"
  currency: string;            // e.g. "INR"
  payload: P;
};

type AiAssistantErrorCode =
  | 'offline'
  | 'timeout'
  | 'auth'
  | 'rate_limit'
  | 'invalid_request'
  | 'invalid_model_output'
  | 'stale_snapshot'
  | 'opt_in_required'
  | 'provider_unavailable';

type AiAssistantResponse<R> =
  | {
      schemaVersion: 1;
      requestId: string;
      snapshotId: string;
      generatedAt: string;       // ISO-8601
      stale: boolean;            // true if snapshot older than policy
      result: R;
    }
  | {
      schemaVersion: 1;
      requestId: string;
      error: { code: AiAssistantErrorCode; message: string };
    };
```

### E2. `monthly_summary`

```ts
type MonthlySummaryRequestPayload = {
  period: { month: number; year: number };
  totals: {
    incomeMinor: number;
    expenseMinor: number;
    netMinor: number;
    savingsRatePercent: number;      // 0–100 integer from calculateSavingsRate
    averageDailyExpenseMinor: number;
  };
  previousPeriod?: {
    incomeMinor: number;
    expenseMinor: number;
  };
  topCategories: Array<{
    categoryId: string;
    categoryName: string;
    amountMinor: number;
    percent: number;                 // 0–100
  }>; // max 8
  budgets: Array<{
    categoryId: string | null;       // null = overall
    label: string;                   // category name or "Overall"
    budgetMinor: number;
    spentMinor: number;
    percent: number;
    warningLevel: 50 | 75 | 90 | 100 | null;
  }>; // max 20
  flags: {
    hasIncome: boolean;
    hasExpenses: boolean;
    transferExcluded: true;          // must always be true in v1
  };
};

type MonthlySummaryResult = {
  headline: string;                  // ≤120 chars
  bullets: string[];                 // 1–5, each ≤160 chars
  interpretations: Array<{
    text: string;                    // ≤200 chars
    relatedCategoryIds?: string[];
  }>; // 0–3
  suggestedActions: Array<{
    id: string;                      // stable key, e.g. "review_category"
    label: string;                   // ≤80 chars
    kind: 'navigate_reports' | 'navigate_budgets' | 'review_category' | 'none';
    categoryId?: string;
  }>; // 0–3 — never auto-applied
  confidence: number;                // 0–1
};
```

**Validation:** Every `amountMinor` / percent the UI labels as fact must match the request payload (±0). AI text may not introduce new numeric claims; client strips or blocks responses that contain digit sequences not present in the snapshot (implementation detail for Phase 2).

**Redacted example request (illustrative):**

```json
{
  "schemaVersion": 1,
  "requestId": "11111111-1111-4111-8111-111111111111",
  "capability": "monthly_summary",
  "snapshotId": "22222222-2222-4222-8222-222222222222",
  "snapshotComputedAt": "2026-10-18T12:00:00.000Z",
  "locale": "en-IN",
  "currency": "INR",
  "payload": {
    "period": { "month": 9, "year": 2026 },
    "totals": {
      "incomeMinor": 8500000,
      "expenseMinor": 6120500,
      "netMinor": 2379500,
      "savingsRatePercent": 28,
      "averageDailyExpenseMinor": 204017
    },
    "previousPeriod": { "incomeMinor": 8500000, "expenseMinor": 5800000 },
    "topCategories": [
      { "categoryId": "cat_food", "categoryName": "Food", "amountMinor": 2100000, "percent": 34 },
      { "categoryId": "cat_travel", "categoryName": "Transport", "amountMinor": 900000, "percent": 15 }
    ],
    "budgets": [
      { "categoryId": null, "label": "Overall", "budgetMinor": 7000000, "spentMinor": 6120500, "percent": 87, "warningLevel": 75 }
    ],
    "flags": { "hasIncome": true, "hasExpenses": true, "transferExcluded": true }
  }
}
```

### E3. `budget_suggestions`

```ts
type BudgetSuggestionsRequestPayload = {
  target: { month: number; year: number };
  lookbackMonths: number;            // 1–6
  overall: {
    currentBudgetMinor: number | null;
    averageSpendMinor: number;
    medianSpendMinor: number;
  };
  categories: Array<{
    categoryId: string;
    categoryName: string;
    averageSpendMinor: number;
    medianSpendMinor: number;
    currentBudgetMinor: number | null;
    volatility: 'low' | 'medium' | 'high';  // deterministic heuristic
  }>; // max 30
};

type BudgetSuggestionsResult = {
  overall?: {
    recommendedMinor: number;
    rationale: string;               // ≤200 chars
    confidence: number;              // 0–1
  };
  categories: Array<{
    categoryId: string;
    recommendedMinor: number;
    rationale: string;
    confidence: number;
  }>; // max 15
  caveats: string[];                 // 0–3, e.g. insufficient history
};
```

**Validation:** `recommendedMinor` must be positive integers; client shows them only as suggestions. Applying calls existing budget create/update after confirm.

### E4. `categorize_merchant`

```ts
type AmountBucket = 'b0_500' | 'b500_2k' | 'b2k_10k' | 'b10k_plus';

type CategorizeMerchantRequestPayload = {
  merchantLabelRedacted: string;     // ≤80
  descriptionRedacted?: string;      // ≤80
  paymentMethod?: 'cash' | 'upi' | 'credit_card' | 'debit_card' | 'bank_transfer' | 'wallet' | 'other';
  amountBucket: AmountBucket;
  candidates: Array<{ categoryId: string; categoryName: string }>; // 1–40
};

type CategorizeMerchantResult = {
  suggestions: Array<{
    categoryId: string;              // must be ∈ candidates
    confidence: number;              // 0–1
    reason: string;                  // ≤120 chars
  }>; // 1–3, sorted by confidence desc
};
```

**Validation:** Drop any `categoryId` not in `candidates`. If empty after filter → treat as `invalid_model_output` and fall back to manual picker.

**Redacted example:**

```json
{
  "schemaVersion": 1,
  "requestId": "33333333-3333-4333-8333-333333333333",
  "capability": "categorize_merchant",
  "snapshotId": "44444444-4444-4444-8444-444444444444",
  "snapshotComputedAt": "2026-10-18T12:05:00.000Z",
  "locale": "en-IN",
  "currency": "INR",
  "payload": {
    "merchantLabelRedacted": "CITY CAFE",
    "paymentMethod": "upi",
    "amountBucket": "b500_2k",
    "candidates": [
      { "categoryId": "cat_food", "categoryName": "Food" },
      { "categoryId": "cat_misc", "categoryName": "Miscellaneous" }
    ]
  }
}
```

---

## F. UX requirements

1. **Three visual lanes** (copy may vary; structure must not):
   - **Calculated** — figures from RxDB / `reportService` (no sparkle/AI chrome).
   - **AI interpretation** — narrative; labelled “AI explanation”.
   - **Suggested action** — buttons disabled until confirm (“Apply”, “Set budget”, “Use category”).
2. Show **supporting figures** next to interpretations (the same numbers as Calculated).
3. Show **confidence** (percent or Low/Medium/High mapped from 0–1), **generatedAt**, and **stale** when `snapshotComputedAt` is older than **24 hours** or the underlying month’s data revision changed (**Proposed:** reuse `financeRevision` / store load generation).
4. **Insufficient data:** if `hasExpenses === false` (summary) or lookback months &lt; 1 with spend (budgets) or `candidates.length === 0` (categorize), do not call the provider; show a calm empty state explaining what to add.
5. AI entry points must not block Home, Reports, or Budgets when AI is off/unavailable.
6. Privacy settings must describe AI opt-in in human language before the first cloud call (**Proposed** update to Privacy screen in Phase 2).

---

## G. Failure behaviour

| Condition | User-visible behaviour | Side effects |
| --- | --- | --- |
| Offline | Keep calculated UI; AI panels show “Connect to the internet to refresh AI explanation.” | No queue of raw ledger to disk for later upload in v1 |
| Provider timeout | “AI took too long. Your numbers below are still accurate.” | Retry once with backoff optional in Phase 2 |
| Invalid AI JSON / schema fail / invented numbers | Discard output; same message as timeout; log only `requestId` + error code | Never partially apply suggestions |
| Authentication failure | Prompt sign-in if cloud AI requires session; local mode unchanged | |
| Rate limit | “AI is busy. Try again in a few minutes.” | |
| Session / account change | Cancel in-flight AI; clear AI UI state; recompute snapshot for new user key | |
| Stale financial snapshot | Show stale badge; primary button “Refresh” recomputes deterministic snapshot before new AI call | |

---

## H. Acceptance criteria and test plan (for Phase 2 implementation)

### H1. Acceptance criteria

1. With AI opt-in **false**, zero network calls to AI endpoints; reports/budgets identical to pre-AI builds.
2. Monthly summary AI text never displays a money amount that differs from the snapshot.
3. Budget suggestions never write RxDB until the user confirms; cancel leaves data unchanged.
4. Merchant categorisation never writes `categoryId` until confirm; rejected IDs outside `candidates`.
5. Redaction unit tests cover digits, UPI, email, URL, notes exclusion.
6. Request &gt; 8 KiB rejected client-side before network.
7. Offline path covered by automated test (mock NetInfo / fetch failure).
8. No SMS/notification permissions added to the Android manifest.
9. No new native modules; fingerprint policy remains `fingerprint` with no AI-driven native churn in v1.
10. Provider secrets absent from app binary and `EXPO_PUBLIC_*` env.

### H2. Test plan (Phase 2)

| Layer | Cases |
| --- | --- |
| Unit | Redaction; amount buckets; snapshot builders from fixtures; response validators; figure cross-check |
| Service | `monthly_summary` / `budget_suggestions` / `categorize_merchant` clients with mocked Edge Function |
| Store/UI | Opt-in gate; stale badge; confirm/cancel; insufficient data; account switch clears AI state |
| Privacy regression | Ensure `notes` and unredacted titles never appear in outbound JSON fixtures |
| Manual | Signed-in opt-in happy path; airplane mode; invalidate session mid-request |

No Phase 2 work starts until this Phase 1 document is approved.

---

## I. Decision log

| Decision | Choice | Why |
| --- | --- | --- |
| Start with chat? | **No** | Chat invites free-form PII paste, unbounded cost, and number hallucination; the three jobs are closed-ended |
| Who calculates? | **Deterministic TypeScript** | Existing `reportService` / `utils/calculations` already define truth; AI adds language only |
| Raw SMS / notifications? | **Excluded** | Not in product; severe privacy/permissions cost; would require native APK changes |
| Protect provider credentials? | **Supabase Edge Function later** | Matches RELEASE.md: no secrets in client/EAS public env; RLS user JWT can authorize the function |
| Merchant field | **Use redacted `title`** | No merchant column exists; avoid schema migration in AI v1 |
| Investments in AI v1? | **No** | Separate domain; exclusion reduces advice liability |
| Default AI state | **Off** | Aligns with Privacy screen’s local-first promise |
| On-device LLM | **Not v1** | Binary size, fingerprint, QA surface |

### Expected cost posture (order-of-magnitude, not a quote)

| Component | Driver | v1 expectation |
| --- | --- | --- |
| Supabase Edge Function | Invocations per explicit user action (not per keystroke) | Low: summary/budget refresh on demand; categorize on ambiguous expense only |
| AI provider tokens | Small JSON envelopes (≤8 KiB in, ≤16 KiB out) | Far cheaper than chat transcripts or full history dumps |
| Client | CPU for aggregates already paid today in reports | Negligible incremental cost when AI off |

Exact SKUs and budgets are chosen in Phase 2 provider selection; Phase 1 only requires provider-neutral contracts.

---

## J. Mapping to existing reusable components

| Reuse | Path / symbol |
| --- | --- |
| Dashboard + month totals | `services/reportService.ts` → `dashboard` |
| Range analytics | `services/reportService.ts` → `analytics` |
| Totals / categories / budget usage | `utils/calculations.ts` |
| Budget list UI patterns | `app/(tabs)/budgets.tsx`, `store/useBudgetStore.ts` |
| Category list | `store/useCategoryStore.ts`, category repositories |
| Transaction edit confirm path | `app/transaction/edit.tsx` (future apply target) |
| Privacy copy baseline | `app/settings/privacy.tsx` |
| Sync/auth session gates | `store/useAuthStore.ts`, `store/useSyncStore.ts` |
| Finance revision bump (stale signal) | `services/financeRevision.ts` (**Proposed** AI stale hook) |

**Phase 2 local analytics (implemented, no AI network):** `services/financialIntelligence/`.

| Contract | Role |
| --- | --- |
| `LocalFinancialSnapshot` via `buildFinancialSnapshot` | On-device diagnostics only. May retain title-derived recurring/anomaly evidence. **Never** treat as an AI request envelope. |
| `AiSafeFinancialSnapshot` via `buildAiSafeFinancialSnapshot(local)` | Aggregate/redacted outbound shape only. Excludes raw titles, title keys, sample merchants, descriptions/notes, transaction/account/user IDs, SMS. Recurring/anomaly evidence is category + counts + amount buckets + multiples. UTF-8 size capped at **8 KiB** with deterministic truncation; fail-closed if still over limit. |
| `contentRevision` | Cache/staleness fingerprint of sorted canonical analytics inputs. **Not** a security hash. Unaffected by `now` / `snapshotComputedAt`. |
| Period averages | Active month → elapsed calendar days; completed → full month length; future → average/projection unavailable. Projected month-end expense (`linear_elapsed`) only for active months with expenses. |
| Adapter | `adaptFinancialSnapshotInput` — structural reject vs per-row skip (documented); soft-delete defence; global currency assumption; caller-scoped inputs. |

**Phase 3 Edge Function foundation (implemented, not deployed):** `supabase/functions/financial-assistant/` — see [AI_PHASE3_EDGE_DECISIONS.md](./AI_PHASE3_EDGE_DECISIONS.md).

| Piece | Role |
| --- | --- |
| `financial-assistant` | Single capability-routed function (`monthly_summary`, `budget_suggestions`, `categorize_merchant`) |
| Auth | User JWT required (`verify_jwt = true` + `auth.getUser`); API keys as Bearer rejected |
| Wire for summary/budgets | **Only** `AiSafeFinancialSnapshot` (`kind: 'ai_safe'`) — `LocalFinancialSnapshot` rejected |
| Wire for categorize | Separate redacted merchant payload; server re-checks D4-like patterns |
| Provider | `FinancialAiProvider` + default `UnavailableFinancialAiProvider` (`FINANCIAL_AI_PROVIDER=unavailable`) — no paid vendor SDK |
| Limits | 8 KiB request / 16 KiB response UTF-8; best-effort in-memory rate limit (non-durable; deploy blocked until durable limiter designed) |
| Consent | Per-request `consent: { cloudAi: true, policyVersion: 1 }` required before provider call |
| Cancellation | Cooperative `AbortSignal` + deadline on provider context; adapters must honor signal |

**Phase 4A client boundary (implemented, no deploy / no live provider calls):** `services/aiAssistant/` + Settings → Privacy.

| Piece | Role |
| --- | --- |
| Device-local consent | RxDB settings v2: `aiCloudEnabled` / `aiConsentPolicyVersion` / `aiConsentAcceptedAt` — default off; never synced to Supabase profiles; migration never enables |
| Privacy UI | Disclosure + ConfirmDialog enable + immediate disable (`app/settings/privacy.tsx`) |
| `redactFinancialText` | Deterministic PII redaction for titles / short descriptions (regex; not a guarantee) |
| Request builders | Allowlisted `monthly_summary` / `budget_suggestions` / `categorize_merchant` envelopes; local 8 KiB reject |
| `invokeFinancialAssistant` | DI transport over `supabase.functions.invoke`; consent + session recheck; cancel/timeout; dedupe; late-response ignore — tests use fakes only |

Still **proposed**: Edge deploy, chosen AI provider adapter, AI response UI / chatbot, budget apply confirmations. Do not send `LocalFinancialSnapshot` on the wire.

---

## K. Risks and unresolved questions

### K1. Overall-budget source — Phase 2 decision (resolved)

| Item | Decision |
| --- | --- |
| **Dual overall-budget source** | **Resolved for analytics reads (no migration).** |

**Current behaviour (evidence):**

| Source | Where written | Where read | Scoped? | Synced? |
| --- | --- | --- | --- | --- |
| Budget row `categoryId === null` | Budgets UI / `BudgetForm` “Overall monthly budget” via `budgetService.create/update` | Budgets tab hero; `budgetService.listWithUsage`; `findOverallBudget`; Home **prefers** this | Per `month`+`year` | Yes (budget outbox) |
| `settings.monthlyBudget` | Onboarding; Settings → Currency | Home **fallback**; profile sync `monthly_budget` | Global (not month-scoped) | Yes (settings/profile) |

**Canonical read for `services/financialIntelligence` snapshots:** the null-`categoryId` budget row for the snapshot period, when `amount > 0`.

**Backwards-compatible fallback:** if that row is absent or non-positive, use `settings.monthlyBudget` when `> 0` (`source: 'settings_fallback'`). If neither qualifies, `amountMinor: null` / `source: 'none'`.

**When both differ:** the budget row wins (matches Home’s preference and the month-scoped Budgets UI). Settings is not overwritten or deleted.

**Explicitly not done in Phase 2:** RxDB/Supabase migration, merging the two stores, or changing Home/Budgets UI write paths. Implementation: `resolveOverallBudgetMinor` in `services/financialIntelligence/`.

### K2. Unresolved decisions (remain open; not decided by Phase 1)

| Item | Status |
| --- | --- |
| **AI provider choice** (OpenAI, Anthropic, Gemini, etc.) | **Unresolved** — contracts stay provider-neutral |
| **Categorisation timing** (add-time vs edit-time vs import-time) | **Unresolved** — product choice for Phase 2 |
| **Legal wording** (how UI copy avoids regulated “financial advice” claims) | **Unresolved** — copy must stay descriptive, not advisory, until legal review |
| Retention of Edge Function logs | Unresolved — must default to minimal retention |
| GitGuardian / secret scanning for future fixtures | Follow existing synthetic-fixture patterns (no live keys) |

---

## L. Phase 1 exit criteria

- [x] Scope document on the feature branch (commit after final review gates in this change)
- [x] Three capabilities + exclusions defined
- [x] Deterministic vs AI split defined
- [x] Privacy allow/deny lists defined
- [x] Provider-neutral schemas + examples defined
- [x] UX, failure, tests, decision log captured
- [x] Aligned to real RxDB fields (gaps marked Proposed)
- [x] Human review of Phase 1 → Phase 2 deterministic analytics implemented on `feature/ai-finance-assistant`

### Phase 2 exit criteria (deterministic analytics)

- [x] Overall-budget canonical source decided with fallback (K1)
- [x] `LocalFinancialSnapshot` + `AiSafeFinancialSnapshot` separation (local never described as AI-safe)
- [x] Canonical `contentRevision`, active-month averages/projection, input adapter, stable ordering, 8 KiB AI-safe boundary
- [x] Unit tests for overall-budget matrix, transfers, cash, soft-delete skip, period status, revision, AI-safe privacy/size
- [x] AI provider / Edge Function / UI — **not** in Phase 2 (Edge foundation moved to Phase 3)

No Edge Function deploy, paid provider SDK, migration, OTA, or Production change is authorized by Phase 2 alone.

### Phase 3 exit criteria (Edge Function foundation)

- [x] Provider-neutral `FinancialAiProvider` + unavailable stub (no paid calls)
- [x] Auth + size + privacy validation for three capabilities
- [x] `AiSafeFinancialSnapshot`-only for summary/budgets; separate categorize contract
- [x] Unit tests for auth, privacy, validation, rate limit, stub provider
- [ ] Deploy / chosen provider / UI — **not** in Phase 3
