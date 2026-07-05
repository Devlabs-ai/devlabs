# Lesson fix tracking (design draft) #24

**Status:** Proposed — review and confirm before implementation.

**Related:** [SPIN failure logs](spin-failure-logs.md), [VALIDATE failure logs](validation-failure-logs.md) — anchor fields for each phase.

## Problem

Today, `lessonStore.record()` runs when SPIN or VALIDATE **succeeds after prior failures** in the same build. It stores:


| Column            | Source today                                                  | Issue                                    |
| ----------------- | ------------------------------------------------------------- | ---------------------------------------- |
| `failure_summary` | Failure snapshots + optional LLM synthesis                    | Mostly grounded in logs/messages         |
| `fix_summary`     | LLM `Fix applied:` / `Avoid:` lines from `synthesizeLesson()` | **Not grounded** — no diff or tool audit |
| `embedding`       | `embed(failure_summary)` only                                 | OK — search matches “what broke”         |


The CODE agent changes files via `write_file`, `write_files`, and `edit_file`, but `**record()` never sees those changes**. Synthesis only gets failure history + final `assets.dockerCompose` and guesses what fixed the problem. That can be plausible but wrong.

**Goal:** Make `fix_summary` (and optional structured fix metadata) reflect **observed changes**, not inferred fixes. Keep embedding on failures only.

---

## Principles

1. **Failures are searchable; fixes are attached after match** — continue embedding `failure_summary` only.
2. **Ground truth for fixes** — tool audit first, asset snapshot diff second, LLM summary last (compression only, not invention).
3. **Lessons are verified** — persist to the global `lessons` table only when a phase **passes** after failures in that phase (current gate stays).
4. **Progressive failures within one build** — track mini-fix steps in memory; do not persist premature partial lessons.

---

## Lessons table schema (current)

Defined in `backend/db/migrate.ts`. Legacy columns (`problem_context`, `lesson_text`, `details`, `type`) were dropped in the slim schema migration; existing rows were backfilled into `failure_summary` and embeddings were nulled for re-embed.

### DDL

```sql
CREATE TABLE IF NOT EXISTS lessons (
  id               SERIAL PRIMARY KEY,
  phase            TEXT NOT NULL CHECK (phase IN ('spin', 'validate')),
  draft_session_id TEXT,
  build_session_id TEXT NOT NULL,
  category         TEXT,
  title            TEXT,
  failure_summary  TEXT NOT NULL,
  fix_summary      TEXT NOT NULL,
  embedding        vector(1536),
  created_at       BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lessons_phase_category
  ON lessons (phase, category);

CREATE INDEX IF NOT EXISTS idx_lessons_embedding
  ON lessons USING hnsw (embedding vector_cosine_ops);
```

### Columns


| Column             | Type           | Nullable | Set by                                                          | Purpose                                                                                          |
| ------------------ | -------------- | -------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `id`               | `SERIAL`       | no       | DB                                                              | Primary key                                                                                      |
| `phase`            | `TEXT`         | no       | `record()`                                                      | Which pipeline phase the lesson is about: `spin` or `validate`                                   |
| `draft_session_id` | `TEXT`         | yes      | `record()`                                                      | Authoring draft that produced this build (optional link)                                         |
| `build_session_id` | `TEXT`         | no       | `record()`                                                      | Build run that learned the lesson                                                                |
| `category`         | `TEXT`         | yes      | `record()`                                                      | Challenge category (filters `findSimilar` / listing)                                             |
| `title`            | `TEXT`         | yes      | `record()`                                                      | Challenge title for Memories UI                                                                  |
| `failure_summary`  | `TEXT`         | no       | `buildFailureSummary()`                                         | What broke — failure snapshots + optional LLM error/root-cause lines; **embedded at write time** |
| `fix_summary`      | `TEXT`         | no       | `buildFixSummary()` today; `formatStagedFixEvidence()` proposed | How it was fixed — shown to CODE on retry; **not embedded**                                      |
| `embedding`        | `vector(1536)` | yes      | `llm.embed(failure_summary)`                                    | pgvector cosine search over past failures; `NULL` if embed failed or pending backfill            |
| `created_at`       | `BIGINT`       | no       | `record()`                                                      | Unix ms timestamp                                                                                |


### Search semantics

- **Write:** `embedding = embed(failure_summary)` only (`lessonStore.record()`).
- **Read:** `findSimilar()` / `findForRetry()` embed the current failure text and query `embedding <=> query` with `maxDistance = 0.45`, optional `phase` and `category` filters, `LIMIT k` (default 8).
- **Backfill:** `backfillEmbeddings()` re-embeds rows where `embedding IS NULL` using `failure_summary`.

### Application types (`backend/types/domain.ts`)


| DB column               | TypeScript (`LessonRecord` / API)                                                    |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `failure_summary`       | `failureSummary`                                                                     |
| `fix_summary`           | `fixSummary`                                                                         |
| `(embedding <=> query)` | `distance` on search hits; exposed as `similarity = 1 - distance` in `RelatedLesson` |


CODE repair payload uses `LessonsBlock`:

```ts
interface RelatedLesson {
  phase: 'spin' | 'validate';
  failureSummary: string | null | undefined;
  fixSummary: string | null | undefined;
  category: string | null;
  similarity: number | null;
}

interface LessonsBlock {
  relatedLessons: RelatedLesson[];
}
```

### Dropped legacy columns (reference)


| Column            | Was used for                                |
| ----------------- | ------------------------------------------- |
| `problem_context` | Draft/problem narrative at insert time      |
| `lesson_text`     | Monolithic lesson body (formerly embedded)  |
| `details`         | JSONB extras (e.g. working compose excerpt) |
| `type`            | Row kind filter (`anti-pattern`, etc.)      |


Do not reintroduce these without a migration plan; new structured fix data should use proposed columns below.

### Proposed extensions (v1 fix-tracking — not migrated yet)


| Column          | Type     | Purpose                                                      |
| --------------- | -------- | ------------------------------------------------------------ |
| `fix_evidence`  | `JSONB`  | Structured tool audit + optional asset diffs (`FixEvidence`) |
| `changed_paths` | `text[]` | Paths touched — quick filter / Memories UI                   |


Embedding policy unchanged: `**failure_summary` only**.

---

## Progressive failure example

```
Attempt 1: SPIN fails with error X
Attempt 2: CODE changes → X gone, SPIN fails with new error Y
Attempt 3: CODE changes → SPIN passes
```


| Question                                                      | Decision                                                                                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Record a mini-lesson after attempt 2 (X resolved, Y remains)? | **No** — not to global `lessons`                                                                                                                                   |
| Why wait?                                                     | SPIN did not pass; fix for X may be incomplete, wrong, or may have caused Y                                                                                        |
| What to do instead?                                           | Track e2, d1, etc. **in build memory only**; on success, persist **one** lesson (see [Storage policy on phase success](#storage-policy-on-phase-success-proposed)) |


---

## Storage policy on phase success (proposed)

Concrete walkthrough — SPIN phase, three iterations:

```
Iter 1: CODE → SPIN fails with e1
        baseline ← snapshot workspace (end of iter 1, when e1 occurred)

Iter 2: CODE → diff d1 = workspace(now) vs baseline → SPIN fails with e2
        (d1, e2 kept in memory only — no DB row)

Iter 3: CODE → diff d2 = workspace(now) vs baseline → SPIN passes
        → record() one lesson
```

### What gets stored


| Field                           | Content                                                                                                                                                                                                                | Embedded? |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `**failure_summary**`           | **e1 only** — the first failure in the phase window (message, stderr, logs / extracted errors from iter 1). Not e2, not full history.                                                                                  | **Yes**   |
| `**fix_summary`**               | **LLM compression of d2** — cumulative asset diff from **baseline (iter 1 workspace)** to **workspace at success (iter 3 post-CODE)**. LLM must only describe changes present in the diff; diff is ground truth input. | No        |
| `fix_evidence` (optional JSONB) | Raw d2 (and optionally d1, e2) for Memories / debugging                                                                                                                                                                | No        |


### Baseline definition

**Baseline** = asset snapshot after **iteration 1** completes CODE and before or at the first SPIN failure in that phase window:

- `docker-compose.yml`, `services/`**, `init/`**, `challenge.json`
- Same tree as `loadAssetsFromBuildDir()`

Every later diff is **cumulative vs that baseline**, not vs the previous iteration:


| When                       | Diff                           | Persisted?                       |
| -------------------------- | ------------------------------ | -------------------------------- |
| After iter 2 CODE          | d1 = assets(iter 2) − baseline | No (in-memory only)              |
| After iter 3 CODE, SPIN ok | d2 = assets(iter 3) − baseline | Yes → input to `fix_summary` LLM |


### Why anchor on e1 + cumulative d2


| Choice                     | Rationale                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **failure = e1**           | Retrieval matches “what you see when the phase first breaks” — cleaner embedding than e1+e2 concatenated.                                      |
| **fix = LLM(d2)**          | Fix is grounded in observed file changes across the whole repair window, not guessed from logs. LLM only compresses; it does not invent edits. |
| **e2 / d1 not in summary** | Intermediate errors are progress inside one build, not a verified lesson row on their own. Optional in `fix_evidence`.                         |


### `failure_summary` shape (e1)

Prefer the **first SPIN failure snapshot** already captured in `spinFailureHistory[0]`:

```
<message from e1>
<stderr / extracted errors / logs from e1, capped>
```

Optional: LLM may add a one-line **error pattern** distilled **from e1 only** (not from e2). Do not run full `synthesizeLesson()` over the whole failure history for the stored row.

### `fix_summary` shape (LLM × d2)

```
Input to LLM:
  - cumulative diff d2 (tool audit or asset snapshot diff, capped)
  - prompt: summarize what changed; cite paths; do not add changes not in the diff

Output → fix_summary (text)
```

If diff is empty or LLM fails → generic fallback line (same as today), not log-inferred fix text.

### VALIDATE — same rule

- **failure_summary** = first VALIDATE failure in the window (e1).
- **fix_summary** = LLM(cumulative diff from baseline after iter 1 to success workspace).
- Baseline includes `challenge.json` / validation spec when validate lessons are recorded.

---

## Recommended data sources (priority order)

### 1. CODE tool audit (primary)

Capture every mutating tool call during CODE phase:


| Tool          | Record                                             |
| ------------- | -------------------------------------------------- |
| `write_file`  | path, full content (or hash + length if over cap)  |
| `write_files` | path per entry                                     |
| `edit_file`   | path, `old_string`, `new_string` (or unified diff) |


**Attach per build iteration** (each CODE invocation in the loop). Accumulate in `buildPipeline` until the phase succeeds or the failure window resets.

**Pros:** Exact, cheap, matches how repair actually works.  
**Cons:** Requires plumbing — today tool I/O is logged via `onEvent` but not returned/stored from `runAgentWithTools` / `codeAgentTools`.

### 2. Asset snapshot diff (fallback)

Before each CODE phase (or immediately after SPIN/VALIDATE failure), snapshot the same tree `loadAssetsFromBuildDir` reads:

- `docker-compose.yml`
- `services/`**
- `init/`**
- `challenge.json` (important for VALIDATE fix lessons)

After CODE (or at `record()` time), diff against the snapshot taken when the **failure window opened**.

**Pros:** Catches changes even if tool audit is missed.  
**Cons:** Whole-file diffs can be large; need caps and changed-path-only output.

### 3. CODE agent text summary (tertiary)

`codeResult.summary` — useful as a one-line headline only, not as source of truth for `fix_summary`.

### 4. LLM synthesis (constrained)

If used at all:

- Input must include **tool audit and/or diff** (required context).
- Prompt: summarize only changes listed below; do not invent paths or edits.
- Do **not** use free-form `Fix applied:` inference from failure logs alone.

---

## Diff window semantics

Track **per-iteration** diffs in memory during the build; persist **one cumulative diff** at success.


| View              | Window                               | Persisted in lesson row?                                       |
| ----------------- | ------------------------------------ | -------------------------------------------------------------- |
| **Baseline**      | End of iter 1 (first failure window) | Stored in memory only; reference for all diffs                 |
| **d1, d2, …**     | assets(iter N) − baseline            | Only **final d** at phase success → feeds `fix_summary` LLM    |
| **Per-hop audit** | CODE tool calls per iteration        | Optional in `fix_evidence`; not required in `fix_summary` text |


Implementation holds in `buildPipeline`:

- `phaseBaselineAssets` — snapshot at first phase failure
- `cumulativeDiffAtSuccess` — baseline → workspace when SPIN/VALIDATE passes
- `spinFailureHistory` / `validateFailureHistory` — e1, e2, … (only **[0]** used for `failure_summary`)

---

## When to call `record()` (unchanged gate)


| Phase    | Trigger                                                   | Inputs used at `record()`                                                        |
| -------- | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| SPIN     | `spin()` succeeds and `spinFailureHistory.length > 0`     | `failure_summary` ← `[0]` (e1); `fix_summary` ← LLM(cumulative diff vs baseline) |
| VALIDATE | Validation passes and `validateFailureHistory.length > 0` | Same pattern; optional `validationFeedback` in LLM diff prompt only              |


Full failure history (e1, e2, …) remains in memory during the build for CODE context; **only e1 and final cumulative diff** are written to the lesson row.

Clear history after successful `record()` (current behavior).

**Do not** insert rows on:

- Error substitution only (X → Y)
- CODE-only success
- Phase failure

---

## Proposed `record()` inputs (additions)

Extend `lessonStore.record()` (or a helper it calls):

```ts
interface CodeChangeRecord {
  attempt: number;
  phase: 'code';           // always CODE; fixes are applied in CODE
  tool: 'write_file' | 'write_files' | 'edit_file';
  path: string;
  // edit_file:
  oldString?: string;
  newString?: string;
  // write_file / write_files:
  contentBytes?: number;
}

interface FixEvidence {
  /** Workspace snapshot at end of iter 1 (baseline) */
  baselineAttempt: number;
  /** Cumulative diff: baseline → workspace at phase success */
  cumulativeDiff: string | null;
  /** Optional: per-iteration diffs and tool audits for debugging / Memories */
  perAttemptDiffs?: Array<{ attempt: number; diff: string }>;
  codeChangesByAttempt?: CodeChangeRecord[][];
  /** Intermediate failures (e2, …) — not copied into failure_summary */
  intermediateFailures?: FailureSnapshot[];
}

/** First failure in the phase window — source for failure_summary / embedding */
type AnchorFailure = FailureSnapshot;
```

**Build path at `record()`:**

```
failure_summary = formatAnchorFailure(anchorFailure)   // spinFailureHistory[0]
embedding       = embed(failure_summary)

fix_summary     = llmSummarizeDiff(cumulativeDiff)     // LLM compresses d2 only
                  OR generic fallback if diff / LLM empty

fix_evidence    = optional JSON(FixEvidence)           // raw d2, d1, e2 for UI
```

**Remove** (for stored row): full-history `buildFailureSummary()`, free-form `Fix applied:` from `synthesizeLesson()` without diff input.

See [Lessons table schema (current)](#lessons-table-schema-current) for column details and proposed `fix_evidence` / `changed_paths` extensions.

---

## Implementation plan (phased)

### Phase A — Instrument CODE (no lesson schema change)

1. In `codeAgentTools`, emit structured change records on write/edit (path, operation, capped payload).
2. Return tool-step history from `runAgentWithTools` (or collect via callback into `buildPipeline`).
3. Append to `codeChangesByAttempt` each iteration; reset or scope per SPIN/VALIDATE failure window.

### Phase B — Wire into `record()`

1. Snapshot `phaseBaselineAssets` on first SPIN/VALIDATE failure in window.
2. On phase success, compute `cumulativeDiff` (baseline → current assets).
3. Pass `anchorFailure` (`history[0]`) + `FixEvidence` into `lessonStore.record()`.
4. Replace `buildFailureSummary()` / `buildFixSummary()` with anchor + LLM(diff) paths above.

### Phase C — Asset snapshot fallback

1. Snapshot assets before CODE when entering repair mode (or after phase failure).
2. Compute text diff at `record()` time if tool audit is empty for an attempt.

### Phase D — UI / ops (optional)

1. Memories page: show staged fix steps when `fix_evidence` exists.
2. `backfillEmbeddings` unchanged (failure-side only).

---

## Size and safety limits


| Limit                            | Suggested value                              |
| -------------------------------- | -------------------------------------------- |
| Max bytes per file in audit/diff | 4–8 KB (truncate with marker)                |
| Max paths per lesson             | 20                                           |
| Max total `fix_summary` length   | ~4 KB (match prompt safety)                  |
| Skip                             | binary files, `.devlabs/`**, build artifacts |


---

## Open questions (confirm before implementation)

1. **Store `fix_evidence` JSONB in v1** (raw d2, d1, e2) or only LLM `fix_summary` text?
2. **Optional one-line error pattern** from e1 via LLM, or raw e1 snapshot only in `failure_summary`?
3. **Baseline timing:** end of iter 1 I  (before first SPIN) vs after first SPIN fail (same iter 1 workspace — should be identical if CODE runs before SPIN each iter)?
4. **VALIDATE:** include `validationFeedback` in the diff-summary LLM prompt when present?

---

## References (current code)


| Area              | File                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Lesson write path | `backend/pipeline/stores/lessonStore.ts` — `record()`, `synthesizeLesson()`, `buildFixSummary()`                           |
| Failure snapshots | `backend/pipeline/pipelines/buildPipeline.ts` — `captureFailureSnapshot()`, `spinFailureHistory`, `validateFailureHistory` |
| CODE tools        | `backend/pipeline/agents/codeAgentTools.ts`                                                                                |
| Asset load        | `backend/pipeline/agents/codeAgent.ts` — `loadAssetsFromBuildDir()`                                                        |
| Tool loop         | `backend/pipeline/helpers/agentRuntime.ts` — `runAgentWithTools()`                                                         |


---

## Summary


| Topic             | Decision                                                                    |
| ----------------- | --------------------------------------------------------------------------- |
| Fix ground truth  | Cumulative diff (baseline → success); LLM compresses diff for `fix_summary` |
| `failure_summary` | **First failure only (e1)** — embedded for search                           |
| `fix_summary`     | **LLM(diff at success)** — not log-inferred                                 |
| Mini-fix on X→Y   | In memory only (e2, d1); not in stored summaries                            |
| Final lesson      | One row at phase success                                                    |
| Search / embed    | `failure_summary` (e1) only                                                 |


Once this doc is confirmed, implementation can start with **Phase A** (CODE instrumentation) without DB migrations.