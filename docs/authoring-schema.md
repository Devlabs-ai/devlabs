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
| `brokenState` | rootCause, validationSymptoms | Phase 1 | VALIDATE (checklist in build UI) |

## Build pipeline

- **Catalogue** is used only during Shape (schema generation). The build agent uses `draft.infra.services` image hints from the approved draft — it does not re-fetch catalogue handbook rows.
- **Validation checklist** — each build iteration emits a checklist: pipeline phases (generate/write/start/validate) plus design symptoms, mechanical steps, and judge result.
- **Logs** — structured, timestamped lines with level icons in the Pipeline tab.
- **OBSERVE** (metrics baseline capture) is deferred; not shown in the pipeline UI.
- **Design validation checklist** — Shape schema preview lists symptoms, services, and metrics intent (pending until build).

## Observable catalogue

Per-category rows live in the `catalogue` table (seeded from `backend/pipeline/catalogue/seeds/catalogue.js` when empty). On normalize:

- `collectCatalogCategories` uses `meta.catalogueCategories` from Phase 1 when set.
- Matching observables merge into `metrics.observe`.

Override per draft: set `metrics.observe: [{ "id": "...", ... }]` to merge with catalogue entries.
