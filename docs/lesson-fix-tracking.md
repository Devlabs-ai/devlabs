# Lesson fix tracking (design draft)

**Status:** Proposed — review and confirm before implementation.

## Problem

Today, `lessonStore.record()` runs when SPIN or VALIDATE **succeeds after prior failures** in the same build. It stores:

| Column | Source today | Issue |
|--------|----------------|-------|
| `failure_summary` | Failure snapshots + optional LLM synthesis | Mostly grounded in logs/messages |
| `fix_summary` | LLM `Fix applied:` / `Avoid:` lines from `synthesizeLesson()` | **Not grounded** — no diff or tool audit |
| `embedding` | `embed(failure_summary)` only | OK — search matches “what broke” |

The CODE agent changes files via `write_file`, `write_files`, and `edit_file`, but **`record()` never sees those changes**. Synthesis only gets failure history + final `assets.dockerCompose` and guesses what fixed the problem. That can be plausible but wrong.

**Goal:** Make `fix_summary` (and optional structured fix metadata) reflect **observed changes**, not inferred fixes. Keep embedding on failures only.

---

## Principles

1. **Failures are searchable; fixes are attached after match** — continue embedding `failure_summary` only.
2. **Ground truth for fixes** — tool audit first, asset snapshot diff second, LLM summary last (compression only, not invention).
3. **Lessons are verified** — persist to the global `lessons` table only when a phase **passes** after failures in that phase (current gate stays).
4. **Progressive failures within one build** — track mini-fix steps in memory; do not persist premature partial lessons.

---

## Progressive failure example

```
Attempt 1: SPIN fails with error X
Attempt 2: CODE changes → X gone, SPIN fails with new error Y
Attempt 3: CODE changes → SPIN passes
```

| Question | Decision |
|----------|----------|
| Record a mini-lesson after attempt 2 (X resolved, Y remains)? | **No** — not to global `lessons` |
| Why wait? | SPIN did not pass; fix for X may be incomplete, wrong, or may have caused Y |
| What to do instead? | Track per-attempt fix deltas **inside the build**; on attempt 3 success, write **one** lesson with **staged** fix steps |

---

## Recommended data sources (priority order)

### 1. CODE tool audit (primary)

Capture every mutating tool call during CODE phase:

| Tool | Record |
|------|--------|
| `write_file` | path, full content (or hash + length if over cap) |
| `write_files` | path per entry |
| `edit_file` | path, `old_string`, `new_string` (or unified diff) |

**Attach per build iteration** (each CODE invocation in the loop). Accumulate in `buildPipeline` until the phase succeeds or the failure window resets.

**Pros:** Exact, cheap, matches how repair actually works.  
**Cons:** Requires plumbing — today tool I/O is logged via `onEvent` but not returned/stored from `runAgentWithTools` / `codeAgentTools`.

### 2. Asset snapshot diff (fallback)

Before each CODE phase (or immediately after SPIN/VALIDATE failure), snapshot the same tree `loadAssetsFromBuildDir` reads:

- `docker-compose.yml`
- `services/**`
- `init/**`
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

A build may have multiple CODE passes before SPIN/VALIDATE passes. Store two views:

| View | Window | Use |
|------|--------|-----|
| **Cumulative diff** | First failure in phase window → phase success | Full story for Memories UI / debugging |
| **Last-hop diff** | CODE on final attempt only | “What finally unblocked the phase” |

For `fix_summary` shown to CODE on retry, prefer **staged narrative** across all hops:

```
Iter 2 (after X): edited docker-compose.yml — added KAFKA_PROCESS_ROLES
Iter 3 (after Y): edited services/api/server.js — fixed DB host env
```

Implementation can hold `codeChangesByAttempt: CodeChangeRecord[][]` in `buildPipeline` for the active SPIN or VALIDATE failure window.

---

## When to call `record()` (unchanged gate)

| Phase | Trigger | `failures` input |
|-------|---------|------------------|
| SPIN | `spin()` succeeds and `spinFailureHistory.length > 0` | All SPIN failure snapshots in window |
| VALIDATE | Validation passes and `validateFailureHistory.length > 0` | All VALIDATE failure snapshots + `validationFeedback` |

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
  /** Mutating tool calls grouped by pipeline attempt */
  codeChangesByAttempt: CodeChangeRecord[][];
  /** Optional fallback: unified diff from asset snapshot */
  assetDiff?: string | null;
  /** Optional: last CODE agent summary line */
  codeSummary?: string | null;
}
```

**New build path for `fix_summary`:**

```
fix_summary = formatStagedFixEvidence(FixEvidence)
  → if empty, fall back to current generic one-liner (not LLM invention)
  → optional: llmSummarizeFixEvidence(evidence) with strict “only cite provided changes” prompt
```

**`failure_summary`:** Keep current snapshot + optional synthesis for error pattern / root cause; no change to embedding target.

---

## Optional schema extensions (later)

Not required for v1; consider if UI or search needs them:

| Column | Type | Purpose |
|--------|------|---------|
| `fix_evidence` | JSONB | Structured tool audit + diffs |
| `changed_paths` | `text[]` | Quick filter / display |

Embedding stays on `failure_summary` only.

---

## Implementation plan (phased)

### Phase A — Instrument CODE (no lesson schema change)

1. In `codeAgentTools`, emit structured change records on write/edit (path, operation, capped payload).
2. Return tool-step history from `runAgentWithTools` (or collect via callback into `buildPipeline`).
3. Append to `codeChangesByAttempt` each iteration; reset or scope per SPIN/VALIDATE failure window.

### Phase B — Wire into `record()`

1. Pass `FixEvidence` from `buildPipeline` into `lessonStore.record()`.
2. Replace LLM-only `buildFixSummary()` with `formatStagedFixEvidence()`.
3. Restrict or remove free-form `Fix applied:` from `synthesizeLesson()` unless `FixEvidence` is present.

### Phase C — Asset snapshot fallback

1. Snapshot assets before CODE when entering repair mode (or after phase failure).
2. Compute text diff at `record()` time if tool audit is empty for an attempt.

### Phase D — UI / ops (optional)

1. Memories page: show staged fix steps when `fix_evidence` exists.
2. `backfillEmbeddings` unchanged (failure-side only).

---

## Size and safety limits

| Limit | Suggested value |
|-------|-----------------|
| Max bytes per file in audit/diff | 4–8 KB (truncate with marker) |
| Max paths per lesson | 20 |
| Max total `fix_summary` length | ~4 KB (match prompt safety) |
| Skip | binary files, `.devlabs/**`, build artifacts |

---

## Open questions (confirm before implementation)

1. **Store `fix_evidence` JSONB in v1** or only formatted `fix_summary` text?
2. **Remove `synthesizeLesson()` fix lines entirely** or keep as compressor over evidence?
3. **Snapshot scope:** before every CODE in repair mode, or only after SPIN/VALIDATE failure?
4. **VALIDATE lessons:** include `challenge.json` / `validationSpec` diff in audit scope by default?

---

## References (current code)

| Area | File |
|------|------|
| Lesson write path | `backend/pipeline/stores/lessonStore.ts` — `record()`, `synthesizeLesson()`, `buildFixSummary()` |
| Failure snapshots | `backend/pipeline/pipelines/buildPipeline.ts` — `captureFailureSnapshot()`, `spinFailureHistory`, `validateFailureHistory` |
| CODE tools | `backend/pipeline/agents/codeAgentTools.ts` |
| Asset load | `backend/pipeline/agents/codeAgent.ts` — `loadAssetsFromBuildDir()` |
| Tool loop | `backend/pipeline/helpers/agentRuntime.ts` — `runAgentWithTools()` |

---

## Summary

| Topic | Decision |
|-------|----------|
| Fix ground truth | Tool audit → asset diff → (optional) constrained LLM summary |
| Mini-fix on X→Y | Track in build memory only; **do not** persist until phase success |
| Final lesson | One row per phase success; staged fix steps from real changes |
| Search / embed | Unchanged — `failure_summary` only |

Once this doc is confirmed, implementation can start with **Phase A** (CODE instrumentation) without DB migrations.
