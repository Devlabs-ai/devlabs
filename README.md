# Devlabs

A technical interview platform where interviewers author broken-infrastructure challenges and candidates debug them live inside real Docker sandboxes.

## Prerequisites

- Docker + Docker Compose (v2)
- Node.js 18+ (the backend uses the global `fetch` API)
- npm 9+
- Linux hosts running Elasticsearch/OpenSearch challenges: `vm.max_map_count` ≥ 262144 — see [docs/host-requirements.md](docs/host-requirements.md)

## Quick Start

### 1. Start Postgres + Redis

```bash
docker compose -f docker-compose.infra.yml up -d
```

### 2. Backend (port 4000)

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

On startup the backend runs idempotent Postgres migrations, restores any in-flight sessions from the database, and seeds the `challenges` table from every `sandbox/verified/<slug>/challenge.json` it finds.

On first boot when the `catalogue` table is empty, the backend auto-seeds handbook rows from `backend/pipeline/catalogue/seeds/catalogue.js` (~30 curated Docker recipes: Postgres, Kafka, Nginx, etc.). The build pipeline injects matching `catalogueBrief` entries (dos, donts, conf) on every GENERATE pass. Learned fixes are stored in `lessons` (requires `OPENAI_API_KEY` for embeddings) after a START or VALIDATE phase succeeds following prior failures in that build. Run `make seed-catalogue-if-empty` manually; seeding is insert-only and never overwrites existing rows.

### 3. Frontend (port 5173)

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>.

## Logging In

The MVP ships with a single hardcoded interviewer account:

| Field    | Value      |
|----------|------------|
| Username | `admin`    |
| Password | `admin123` |

Interviewers can create one-time candidate invites from the **Invites** panel. A candidate visits `http://localhost:5173/?candidate=<token>` to play without a JWT.

## Sample Challenge

`sandbox/verified/broken-postgres/` ships out of the box. The candidate sees high latency from an `orders-service` that runs `SELECT … WHERE user_id = $1` against an unindexed 50k-row table. Running

```sql
CREATE INDEX idx_orders_user_id ON orders(user_id);
```

inside the postgres container drops latency to ~5–15 ms. After 10 consecutive readings under 50 ms the session is marked `recovered = true`.

## Project Layout

```
backend/      Node/Express + WS server
frontend/     Vite + React UI
sandbox/      Per-challenge Docker compose bundles
  verified/   Permanent, finalised challenges
  builds/     Ephemeral build artifacts (reserved for AI build pipeline)
  sessions/   Per-game working copies (auto-cleaned)
```

## Excluded From This MVP

- AI-driven Problem Setter and build pipeline (`routes/problems.js`, `routes/reviews.js`, `pipeline/*`).
- Frontend pages: `ProblemSetterPage`, `PipelinePage`, `ReviewPage`.
- Legacy `dockerode`-based sandbox path. All challenges must ship a `verifiedDir`.
