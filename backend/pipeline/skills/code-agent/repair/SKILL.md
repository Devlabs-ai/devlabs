---
name: code-agent-repair
mode: repair
---

# Repair skill

**When the pipeline uses this skill:** iteration 2+, or after SPIN/VALIDATE/CODE verification failure. The server sets `mode: repair` and includes `previousAttempt` plus derived `failureContext` — you do not choose the skill.

## Goal

Apply a **short, targeted patch** — not a re-scaffold. Fix the reported failure while preserving intentional broken behavior unless the judge says the bug is not reproducible.

## Workflow

1. **ORIENT** — read `failureContext.repairPlan` first (failure, targetFile, goodRepair steps).
   - Also scan `actionHint`, `fileSnippet`, and `previousAttempt.details`.
   - Use `workspaceTree` objectives to pick files. Do **not** **Glob** for orientation.

2. **INVESTIGATE** (minimal) — **Read** / **Grep** only files justified by the failure:
   - SPIN/Dockerfile/build → Dockerfiles, compose, deps
   - VALIDATE/evidence → challenge.json validationSpec + services in that graph
   - Skip **Read** if `failureContext.fileSnippet` already has the target file.

3. **FIX** — after primary file is in context, **next step must be Edit or Write**:
   - Prefer **Edit** on existing files
   - **Write** only for new files or full rewrites

4. **STOP** — text summary when edits are done. No self-verify Read/Grep pass.

## Constraints

- Repair must apply at least one **Edit** or **Write** when SPIN/VALIDATE failure triggered the iteration
- Do **not** run shell commands — SPIN handles Docker

## Failure phase routing

| Phase | Fix |
|-------|-----|
| CODE / scaffold verify | compose, missing Dockerfiles/volumes, HOST_PORT placeholders |
| SPIN | Dockerfile, deps, compose, SQL, broker config |
| VALIDATE (scaffold/runtime) | Serialization, 500s, graph abort on health — fix blocking errors |
| VALIDATE (unobservable bug) | validationSpec.graphs — do **not** remove intentional broken behavior unless judge says so |

## Good vs bad repair

**Good:** **Read** or skip (fileSnippet) → **Edit** on target → stop.

**Bad:** **Glob** → **Read** → **Grep** → **Read** again → stop without editing.

## Bug vs scaffold

- **Fix** scaffold/runtime errors (Decimal/JSON, 500 on GET) that block validation graphs.
- **Do not** remove the interview cache/infra bug unless judge feedback says it is not reproducible.
