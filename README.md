# Devlabs

A technical interview platform for production-style challenges. Candidates solve real Spark (and compose) incidents in live workspaces — not toy puzzles.

---

## What Devlabs is (v0.2)

**Play** — run a candidate through a challenge: incident brief, workspace, Run/Submit, grading signals.

Authoring and review pipelines are out of scope for v0.2; challenges are curated via the manual catalog seed.

---

## Local development

```bash
make install
make infra-up
make dev
```

- Frontend: http://localhost:5173  
- Backend: http://localhost:4000  

Spark play sessions require MinIO + the Spark platform API (see `backend/.env.example`).

---

## Roadmap

### Devlabs V0.2 — Evaluation & Play *(current)*

Focus:

- Spark-platform challenges with MinIO-backed workspaces
- Run / Submit / grade against golden outputs
- Fair assessment under chosen AI-assistance rules (upcoming)

Authoring (design → build → review → promote) is deferred past v0.2.
