# `catalogue` table schema

Curated, ops-maintained handbook: **image/infra facts** and **observable definitions** on the same row per technology bucket.

- **One row per `category`** (e.g. `postgres`, `redis`, `global`).
- **One row per `category`** — aligns with `catalogue/seeds/catalogue.js` (one canonical image per category).
- Queried at **draft creation / normalize** → attached as verified context for Shape & Build.
- **Not** used for semantic retry — that stays in `lessons`.
- **Not** used for measured runtime values — those stay in `draft.metrics.observed`.

---

## Table

```sql
CREATE TABLE catalogue (
  id              SERIAL PRIMARY KEY,

  -- Technology bucket — unique row key
  category        TEXT NOT NULL UNIQUE,

  -- -------------------------------------------------------------------------
  -- Image & infra (nullable for global-policy or metrics-only rows)
  -- -------------------------------------------------------------------------
  image           TEXT,
  image_hints     JSONB NOT NULL DEFAULT '[]',
  port            INT,
  dos             JSONB NOT NULL DEFAULT '[]',
  donts           JSONB NOT NULL DEFAULT '[]',
  conf            JSONB NOT NULL DEFAULT '{}',
  default_limits  JSONB,
  handbook_text   TEXT,

  -- -------------------------------------------------------------------------
  -- Observables (definitions only — not measured values)
  -- -------------------------------------------------------------------------
  metric_format   TEXT,
  observables     JSONB NOT NULL DEFAULT '[]',

  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);
```

---

## Column reference

| Column | Type | Purpose |
|--------|------|---------|
| `category` | `TEXT` | Unique bucket key: `postgres`, `redis`, `kafka`, `spark`, `load-generator`, `global`, … |
| `image` | `TEXT` | Canonical Docker image (e.g. `postgres:16-alpine`) |
| `image_hints` | `JSONB` | Alternate tags, registry notes |
| `port` | `INT` | Default in-network port |
| `dos` | `JSONB` | String array — required practices |
| `donts` | `JSONB` | String array — forbidden patterns (Bitnami, invented tags, …) |
| `conf` | `JSONB` | Structured compose/env: `{ "composeFragment": { ... } }`; optional `draftDefaults` for legacy-import service/metrics stubs |
| `default_limits` | `JSONB` | `{ "cpus": "0.5", "memory": "256M" }` for `infra.services` defaults |
| `handbook_text` | `TEXT` | Long paragraph for Design/Build agents |
| `metric_format` | `TEXT` | e.g. `METRIC latency=<float> errors=<int> dbCpu=<float>` |
| `observables` | `JSONB` | Array of observable specs (see below) |

---

## `observables` JSON shape

Each element:

```json
{
  "id": "spike_to_steady_ratio",
  "algorithm": "spike_ratio",
  "field": "latency",
  "segment": null
}
```

Supported `algorithm` values (OBSERVE phase): `median`, `max`, `min`, `sum`, `spike_ratio`, `dominant_period`, `max_rate_per_minute`.

Optional `segment`: `"steady"` | `"spike"` | null.

---

## Example rows

### Postgres (image + metrics)

```json
{
  "category": "postgres",
  "image": "postgres:16-alpine",
  "port": 5432,
  "dos": ["Set POSTGRES_USER/PASSWORD/DB", "Mount init SQL in /docker-entrypoint-initdb.d/"],
  "donts": ["Do not use bitnami/postgresql"],
  "conf": {
    "composeFragment": {
      "environment": {
        "POSTGRES_USER": "postgres",
        "POSTGRES_PASSWORD": "postgres",
        "POSTGRES_DB": "shop"
      }
    }
  },
  "default_limits": { "cpus": "1.0", "memory": "512M" },
  "handbook_text": "...",
  "metric_format": "METRIC latency=<float> errors=<int> dbCpu=<float>",
  "observables": [
    { "id": "latency_steady_median_ms", "algorithm": "median", "field": "latency", "segment": "steady" },
    { "id": "spike_to_steady_ratio", "algorithm": "spike_ratio", "field": "latency" },
    { "id": "db_cpu_spike_median", "algorithm": "median", "field": "dbCpu", "segment": "spike" }
  ]
}
```

### Redis

Same shape; `category: "redis"`, `image: "redis:7-alpine"`, observables tuned for cache/stampede patterns.

### Global (policy-only)

```json
{
  "category": "global",
  "image": null,
  "donts": ["NEVER use Bitnami images", "Do not invent image tags"],
  "handbook_text": "...",
  "metric_format": null,
  "observables": []
}
```

### Load-generator (metrics-only)

```json
{
  "category": "load-generator",
  "image": null,
  "metric_format": "METRIC latency=<float> errors=<int> dbCpu=<float>",
  "observables": [
    { "id": "errors_max_per_minute", "algorithm": "max_rate_per_minute", "field": "errors" }
  ]
}
```

---

## How drafts use this

Selection is **application logic** at normalize / Shape:

1. Collect categories from `draft.meta.category`.
2. Collect categories from each `infra.services[].name` / `image_hint` (e.g. name contains `redis` → `redis`).
3. Always include `global`.
4. If any service looks like a load-generator → include `load-generator`.
5. `SELECT * FROM catalogue WHERE category = ANY($1)`.

Merge into `draft.catalogueContext`:

```json
{
  "entries": [ /* full rows */ ],
  "images": [ /* rows with image set */ ],
  "observables": [ /* flattened from all rows' observables + metric_format */ ],
  "policies": [ /* global donts/dos */ ]
}
```

Design/Build agents treat **`catalogueContext` as the only verified source** for images and observable ids. **`lessons`** remain separate for failure/retry semantics.

---

## What this table is not

| Data | Table |
|------|--------|
| Measured baseline after build | `draft.metrics.observed` |
| Learned fixes from failed builds | `lessons` |
| Candidate-facing story | `draft.description` |
| Setter root cause | `draft.brokenState` |

---

## Migration note

Seed from `backend/pipeline/catalogue/seeds/catalogue.js` only when the `catalogue` table is **empty** (boot + `--if-empty` CLI).

- **One entry per `category`** — canonical `details.image`; alternates in `details.imageHints` only.
- Image handbook + observable definitions live on the same row (`metric_format`, `observables`).
- **Insert-only** — no backfill from `specialists`, no upsert over existing rows, no import from legacy `observableCatalog/` files.

`specialists` has been removed; the build pipeline reads handbook context from the `catalogue` table via `catalogueBrief`.
