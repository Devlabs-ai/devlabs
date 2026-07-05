---
name: code-agent-scaffold
mode: scaffold
---

# Scaffold skill

**When the pipeline uses this skill:** first build iteration, or workspace without a prior failed SPIN/VALIDATE repair context. The server sets `mode: scaffold` in the user payload — you do not choose the skill.

## Goal

Create the full sandbox from scratch **inside `workspaceRoot`** from the user payload: root **docker-compose.yml**, **services/****/** (Dockerfile + app per built service), **init/***, **challenge.json**, and any compose volume dirs (e.g. `dags/`, `logs/`).

## challenge.json validationSpec

The user payload includes **`validationSpecTemplate`** — server-generated from `draft.brokenState.validationSymptoms`.

1. Copy **`validationSpecTemplate`** into `challenge.json` as `validationSpec` (adjust paths, PUT bodies, and `cmd` args to match your routes and DB name).
2. Do **not** invent `setup` / `perturb` / `observe` / `judge` keys or HTTP `url` fields.
3. HTTP graph nodes: `{ "type": "http", "service": "<compose-service>", "path": "/..." }` — the runner resolves host ports.
4. Exec graph nodes: `{ "type": "exec", "service": "postgres", "cmd": ["psql", ...] }`.
5. Wait nodes: `{ "type": "wait", "ms": 150 }`.

## Workflow

1. **IMPLEMENT** — write all files in as few tool rounds as possible **under `workspaceRoot` only**.
  - Read `buildDir` / `workspaceRoot` from the user payload first.
  - Prefer multiple **Write** calls in the **same** turn.
  - Use absolute `file_path` under `workspaceRoot` or relative paths (e.g. `docker-compose.yml`) — never `/tmp/...` or other roots.
  - Use `draft.codebase` when present: `dockerCompose`, `dockerfiles[]`, `pythonServices[]`, `initFiles[]`.
  - Use `draft.readyServices` for validationSpec.readyServices when present (or copy from `validationSpecTemplate`).
  - Set `challenge.json` → `validationSpec` from **`validationSpecTemplate`** in the user payload.
  - Implement `brokenState.rootCause` in app code without comments that reveal the bug.
2. **STOP** — brief text-only summary. **No more tool calls.**

## Rules

- Do **not** run a Grep/Read self-verification pass — the server runs `verifyBuildComplete` next.
- Do **not** use **Glob** for orientation unless the draft is ambiguous (rare on scaffold).
- Prefer **validationSpec.graphs** over legacy steps.
- Python v1: one Flask app per custom service at `services/<name>/app.py` + Dockerfile.
- Do **not** run shell commands — SPIN starts Docker after you finish.

## Stop condition

All core artifacts on disk → text summary → end turn.
