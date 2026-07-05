# Devlabs CODE invariants (all modes)

## Source of truth

The user message JSON payload is authoritative:

- `buildDir` / `workspaceRoot` — **the only directory** for Read/Write/Edit; server rejects paths outside it
- `workspaceNote` — path rules (also below)
- `draft.infra.services[]` — service names, image_hint (from Schema)
- `draft.brokenState` — rootCause + validationSymptoms → validationSpec.graphs
- `draft.sandboxSpec` — optional layout hints
- `draft.codebase` — when present: dockerCompose, dockerfiles[], pythonServices[], initFiles[]
- `draft.readyServices` — when present: SPIN gating hint
- `lessonsBlock` — past failure/fix summaries on retry
- `previousAttempt` — last failed phase (SPIN, VALIDATE, or CODE) with capped `details`
- `validationSpecTemplate` — canonical validationSpec.graphs shape from draft symptoms (use when writing/fixing challenge.json)
- `workspaceTree` / `failureContext` — repair iterations only

Derive layout from the draft. Every challenge needs **docker-compose.yml** (root), **services/***, **init/***, **challenge.json**.

## Build workspace (critical)

- `workspaceRoot` in the user payload is the build sandbox on disk (same as `buildDir`).
- **All Read / Write / Edit `file_path` values must resolve inside `workspaceRoot`.**
- Use absolute paths under `workspaceRoot` (Claude Code Write prefers absolute) **or** paths relative to it (`docker-compose.yml`, `dags/order_pipeline.py`).
- **Never** write to `/tmp`, `/work`, `/build`, or any path outside `workspaceRoot` — the server denies them and verification only checks `workspaceRoot`.
- Create bind-mount directories (e.g. `./dags`, `./logs`) under `workspaceRoot` before you stop.

Writable paths (relative to workspace root): `docker-compose.yml`, `challenge.json`, `services/*`, `init/*`, plus any dirs referenced by compose volume mounts.

## challenge.json

Required top-level: title, description, difficulty, category, tags, problemStatement, validationSpec.

**Preferred: validationSpec.graphs (v2)** — one DAG per `validationSymptoms[]` entry.

- `graphs.length` MUST equal `validationSymptoms.length` (same ids, same order)
- Copy symptom id → `symptomId`, check text → `symptomCheck` verbatim
- Each entry MUST wrap a DAG: `graph: { entry: "<nodeId>", expectBroken: true, nodes: { ... } }`
- Do **not** use top-level `setup` / `perturb` / `observe` / `judge` keys — those are design concepts; the executor only reads `graph.entry` + `graph.nodes`
- Node types inside `graph.nodes`: http, exec, wait, fork, join, background, stop
- **HTTP nodes:** `service` (compose service name) + `path` (e.g. `/products/1`) — never `url` or `${HOST_PORT_*}` (the runner resolves host ports from compose)
- **Exec nodes:** `cmd` as string array — never `command`
- **Wait nodes:** `ms` (milliseconds) — not `timeout`
- Chain nodes with `next: ["<nodeId>"]`; prefix node ids with `s{N}_` per symptom
- Action nodes capture snapshots; the validation judge compares before/after per symptom

`readyServices` = compose services labelled `devlabs.role: infra` (databases, brokers, caches, HTTP APIs).

Legacy `validationSpec.steps` or single `validationSpec.graph` still accepted if graphs cannot be built.

See `backend/pipeline/validation/examples/stale-cache-validation.graph.json` for a full graphs example.

## docker-compose.yml

Root-level orchestration. After your tool loop, `verifyBuildComplete` runs — failures block SPIN.

**Host ports (exact syntax):**

```
ports:
  - "${HOST_PORT_ORDER_API}:5000"
```

- Never hardcode host ports
- Never use `${HOST_PORT_X:-19091}:9092` (default-value syntax fails verification)
- At least one `${HOST_PORT_*}` in the file

**image vs build** (from `draft.infra.services[].image_hint`):

- Public image (postgres:16, redis, kafka, …) → `image:` only
- App base (python:3.11-alpine) → `build: { context: ./services/<name> }` + `services/<name>/Dockerfile`

**Labels (every service):** `devlabs.role: infra | worker | one-shot`

**depends_on:** `service_healthy` OK on image infra; **forbidden** on custom `build:` services (use `service_started`).

**Volumes:** bind paths must exist on disk before you stop.

## Post-code checklist (server verifies — do not grep/read to self-check)

- [ ] docker-compose.yml and challenge.json exist
- [ ] At least one `${HOST_PORT_*}:<port>` (no `:-default`)
- [ ] devlabs.role on every service
- [ ] Every `build:` has `services/<name>/Dockerfile`
- [ ] image_hint infra uses `image:`, not `build:`, unless Dockerfile exists
- [ ] No `service_healthy` on custom built services
- [ ] validationSpec.graphs or steps present; readyServices non-empty
- [ ] Dockerfile COPY targets exist; npm ci requires package-lock.json
- [ ] No comments hinting at the bug, root cause, or intended fix
