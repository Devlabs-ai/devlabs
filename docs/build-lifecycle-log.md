# Build lifecycle log (on disk)

**Status:** Implemented.

**Related:** [SPIN failure logs](spin-failure-logs.md), [VALIDATE failure logs](validation-failure-logs.md), [#22 repair diff logs](repair-diff-logs.md).

---

## Purpose

Every **POST /build** run (all iterations in one stretch — CODE → SPIN → VALIDATE, up to 5 times) emits many pipeline events. The UI and draft DB only keep a **subset** of those (and cap at 1000 lines in `buildLogs`).

The **build lifecycle log** captures **every event** on disk for post-mortem troubleshooting: agent tool steps, diffs, phase transitions, validation results, failures, and session boundaries.

---

## Location

```text
sandbox/builds/<buildSessionId>/.devlabs/build-lifecycle.jsonl
```

- One file per build **workspace** (same folder as `docker-compose.yml`, `services/`, etc.).
- **Retry in same workspace** appends a new `session_start` block — full history across HTTP retries is preserved.
- **Fresh build** (`mode=fresh` or new UUID folder) starts a new file.
- **Teardown** (`teardownBuild`) deletes the whole workspace including this log.

The pipeline logs the relative path at session start:

```text
lifecycleLog: ".devlabs/build-lifecycle.jsonl"
```

---

## Format

**JSON Lines** — one JSON object per line:

```json
{"ts":"2026-06-29T12:00:00.000Z","event":{"type":"session_start","draftSessionId":"...","buildSessionId":"...","resumed":false,"buildDir":"...","lifecycleFile":".devlabs/build-lifecycle.jsonl"}}
{"ts":"2026-06-29T12:00:01.000Z","event":{"type":"phase","phase":"CODE","attempt":1,"total":5}}
{"ts":"2026-06-29T12:00:02.000Z","event":{"type":"log","level":"info","tag":"code","message":"CODE agent (scaffold) ..."}}
{"ts":"2026-06-29T12:00:05.000Z","event":{"type":"codeStep","step":0,"tools":"Read","hint":"services/api/app.py",...}}
{"ts":"2026-06-29T12:00:06.000Z","event":{"type":"codeDiff","tool":"Edit","path":"services/api/app.py","diff":"..."}}
```

Session ends with:

```json
{"ts":"...","event":{"type":"session_end","status":"success","attempts":2,"buildSessionId":"..."}}
```

or `"status":"exhausted"` when all iterations fail.

---

## Events recorded

Everything passed to the pipeline `onEvent` handler during `runBuildLoop`:

| Event type | Contents |
| ---------- | -------- |
| `session_start` / `session_end` | Boundaries, draft/build IDs, outcome |
| `phase` | CODE / SPIN / VALIDATE + attempt number |
| `log` | Structured logs from build, code, spin, validate agents |
| `thinking` | CODE agent working indicator |
| `codeStep` | Per-turn tool summary (Read/Edit/Write/Grep/Glob) |
| `codeDiff` | Full repair diffs (per file + cumulative summary) |
| `buildDir` | Workspace path |
| `checklist` | Iteration checklist snapshot |
| `validation` | Full judge result (feedback, suggestions, evidence) |
| `done` | Successful build payload |
| `error` | Terminal failure (includes `lastAttempt` when exhausted) |

**Not truncated** except a 4MB safety cap per line (extremely large single events get a `_truncated` marker).

---

## vs other logs

| Store | Scope | Truncation |
| ----- | ----- | ---------- |
| **`build-lifecycle.jsonl`** | Full pipeline, all event types | 4MB/line safety only |
| **`draft.buildLogs` (DB)** | UI stream subset | 1000 lines; mostly `log`, `thinking`, `codeDiff` |
| **`.devlabs/spin-failure.log`** | SPIN compose/container streams only | Full (SPIN phase) |
| **`.devlabs/errors/latest.json`** | Last failure snapshot | Capped repair details |

Use the lifecycle log when you need the **complete story** of what agents did across iterations.

---

## Reading the log

**Tail live during a build:**

```bash
tail -f sandbox/builds/<buildSessionId>/.devlabs/build-lifecycle.jsonl
```

**Filter by phase:**

```bash
jq -r 'select(.event.type=="phase") | "\(.ts) \(.event.phase) attempt \(.event.attempt)"' \
  sandbox/builds/<id>/.devlabs/build-lifecycle.jsonl
```

**Extract CODE diffs:**

```bash
jq -r 'select(.event.type=="codeDiff") | .event.path' \
  sandbox/builds/<id>/.devlabs/build-lifecycle.jsonl
```

**Last validation result:**

```bash
jq 'select(.event.type=="validation") | .event.result' \
  sandbox/builds/<id>/.devlabs/build-lifecycle.jsonl | tail -1
```

---

## Implementation

| File | Role |
| ---- | ---- |
| `backend/pipeline/build/buildLifecycleLog.ts` | Append JSONL records |
| `backend/pipeline/pipelines/buildPipeline.ts` | Wraps `onEvent` with lifecycle tee in `runBuildLoop` |

---

## Verification

1. Trigger a multi-iteration build (fail SPIN or VALIDATE once, then succeed).
2. Confirm `.devlabs/build-lifecycle.jsonl` exists under the build workspace.
3. Confirm file contains `session_start`, multiple `phase` events, `codeStep`/`codeDiff`, `validation`, and `session_end`.
4. Retry build in same workspace — confirm a second `session_start` with `"resumed":true` and appended events (file not reset).
