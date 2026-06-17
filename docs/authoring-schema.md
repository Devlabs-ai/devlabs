# Authoring draft schema (v1)

## Two-phase Shape

1. **Phase 1 — Design contract** (`POST /api/problems/:id/chat`): agent emits `<shape_contract>` JSON with description, meta (name, category, difficulty, catalogueCategories), arch, infra service **names**, brokenState (rootCause + validationSymptoms), metricsIntent. Legacy tags still parsed as fallback.
2. **Approve** (`POST /api/problems/:id/approve-design`): locks the full contract; all required fields must be present.
3. **Phase 2 — Schema** (`POST /api/problems/:id/generate-schema`): queries catalogue for locked categories, materializes images/limits/codebase/data; server re-applies locked Phase 1 fields after LLM output.

Drafts are stored as JSON (`schemaVersion: 1`) in `draft_sessions.draft`.

## Phase 1 vs Phase 2 ownership

| Field | Phase 1 (intent) | Phase 2 (implementation) |
|-------|------------------|---------------------------|
| `description` | Required | Copied verbatim |
| `meta.catalogueCategories` | Required | Copied; drives catalogue query |
| `meta.name`, `difficulty`, `tags` | Required name/category/difficulty | Copied |
| `arch` | Required qualitative | Copied verbatim |
| `infra.services[].name` | Required names only | + `image_hint`, limits from catalogue |
| `brokenState.rootCause` | Required | Copied verbatim |
| `brokenState.validationSymptoms` | Required qualitative | Meaning preserved; wording may refine for build |
| `metrics.display.guidance` | From metricsIntent | + format, observe from catalogue |
| `codebase`, `data` | — | Generated |

## Sections

| Field | Shape | Authoring | Pipeline |
|-------|--------|-----------|----------|
| `meta` | id, name, category, difficulty, author, tags | Agent / import | Specialist matching |
| `description` | candidate story | Phase 1 | Build / candidate UI |
| `infra` | services | Phase 1 names, Phase 2 images | Compose |
| `arch` | topology narrative | Phase 1 | Build agent |
| `codebase` | artifacts | Phase 2 | GENERATE step |
| `data` | tables, seeds | Phase 2 | init SQL |
| `metrics` | format, display, recovery; `observe` (auto); `observed` (pipeline) | Phase 2 + catalogue | OBSERVE after VALIDATE |
| `brokenState` | rootCause, validationSymptoms | Phase 1 | CODE agent → one DAG per symptom |

## Validation: design symptoms → executable DAGs

### Phase 1 (Design)

Authors define **`brokenState.validationSymptoms`**: each entry is a **detailed observation recipe** — what action to perform and what wrong/stale result proves the bug.

```json
{
  "validationSymptoms": [
    {
      "id": 1,
      "check": "GET /products/2 and note name/price. PUT /products/2 with sentinel name VALIDATION_SENTINEL and price 1234.56. GET /products/2 again — still returns the OLD name/price (stale cache hit after write)."
    },
    {
      "id": 2,
      "check": "After that PUT, redis-cli GET product:2 in the redis container still returns the pre-update cached JSON — Postgres was updated but Redis was not invalidated."
    },
    {
      "id": 3,
      "check": "PUT /products/3 with name StaleTestProduct, GET /products/3 — response does not contain StaleTestProduct (same stale pattern on another id)."
    }
  ]
}
```

Symptoms are **qualitative design intent**. They are not executed directly.

### Build (CODE agent)

For **each** `validationSymptoms[]` entry, the CODE agent emits **one** item in `challenge.json` → `validationSpec.graphs[]`:

| Design field | challenge.json field |
|--------------|----------------------|
| `id` | `symptomId` |
| `check` | `symptomCheck` (copied verbatim) |
| (derived) | `graph` — action DAG: setup → perturb → observe **for this symptom only** |

**Rules:**

- `graphs.length === validationSymptoms.length` (same ids).
- Do **not** merge multiple symptoms into one graph.
- Each graph is self-contained (may repeat warm-cache / health nodes per symptom).
- No programmatic assert nodes — action nodes produce **snapshots**; the validation **judge** compares before/after per symptom.

### Validate (pipeline)

1. Executor runs each graph sequentially; snapshots tagged with `symptomId`.
2. Judge receives `graphRun.graphs[]` with snapshots and decides if `brokenState` is reproducible (`expectBroken: true` at build time).

### Example: stale product cache (3 symptoms → 3 graphs)

Full reference: `backend/pipeline/validation/examples/stale-cache-validation.graph.json`

**Symptom 1 DAG** — read-after-write staleness:

```text
health → warm cache → baseline GET → PUT sentinel → wait → GET after
(judge: after body matches baseline, not sentinel)
```

**Symptom 2 DAG** — Redis not invalidated:

```text
warm GET → redis GET before → PUT → wait → redis GET after
(judge: redis after equals redis before)
```

**Symptom 3 DAG** — second product id (optional extension):

```text
PUT /products/3 → wait → GET /products/3
(judge: GET missing new name)
```

Optional `fork` / `background` nodes belong **inside** the symptom they support (e.g. “under load, read-after-write still stale”) — not as a shared mega-graph.

### Legacy

- `validationSpec.steps[]` — flat list (still supported).
- `validationSpec.graph` — single graph (deprecated; prefer `graphs[]`).

## Build pipeline

- **Catalogue** is used only during Shape (schema generation). The build agent uses `draft.infra.services` image hints from the approved draft — it does not re-fetch catalogue handbook rows.
- **Validation checks** — each build iteration runs validation graphs (or legacy steps) and a judge verdict in the Pipeline tab checklist.
- **Logs** — structured, timestamped lines with level icons in the Pipeline tab.
- **OBSERVE** (metrics baseline capture) is deferred; not shown in the pipeline UI.
- **Design validation checklist** — Shape schema preview lists symptoms, services, and metrics intent (pending until build).

## Observable catalogue

Per-category rows live in the `catalogue` table (seeded from `backend/pipeline/catalogue/seeds/catalogue.js` when empty). On normalize:

- `collectCatalogCategories` uses `meta.catalogueCategories` from Phase 1 when set.
- Matching observables merge into `metrics.observe`.

Override per draft: set `metrics.observe: [{ "id": "...", ... }]` to merge with catalogue entries.
