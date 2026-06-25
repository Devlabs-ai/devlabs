---
name: code-agent-scaffold
mode: scaffold
---

# Scaffold skill

**When the pipeline uses this skill:** first build iteration, or workspace without a prior failed SPIN/VALIDATE repair context. The server sets `mode: scaffold` in the user payload — you do not choose the skill.

## Goal

Create the full sandbox from scratch: root **docker-compose.yml**, **services/****/** (Dockerfile + app per built service), **init/***, **challenge.json** with **validationSpec.graphs** (one graph per design symptom).

## Workflow

1. **IMPLEMENT** — write all files in as few tool rounds as possible.
  - Prefer multiple **Write** calls in the **same** turn.
  - Use `draft.codebase` when present: `dockerCompose`, `dockerfiles[]`, `pythonServices[]`, `initFiles[]`.
  - Use `draft.readyServices` for validationSpec.readyServices when present.
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
