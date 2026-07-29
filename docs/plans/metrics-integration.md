# Plan: Integrate Domo Metrics API (`/api/content/v1/metrics`)

**Status:** Phase 1 implemented (`src/metrics/`, PR #42); Phases 2–4 draft
**Created:** 2025-07-28
**Updated:** 2026-07-29

## Problem

Huckleberry agents need the ability to create, retrieve, execute, and manage Domo Metrics — saved KPI definitions that aggregate over datasources. The upstream API lives in `apiContent` at `/api/content/v1/metrics` and is fully operational. Huckleberry currently has no proxy surface for it.

## Upstream API Overview

The metrics domain in `apiContent` (`content-app/src/main/java/com/domo/api/content/metrics/`) provides 28 endpoints across four functional groups:

| Group            | Endpoints                                                                                      | Notes                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **CRUD**         | create, get, list, update, delete, bulk delete, unarchive, change owner, filter, by-datasource | All require `HAS_AUTHORITY_AUTOMATED_INSIGHTS` + feature switch `metrics` enabled |
| **SQL/Execute**  | preview, get SQL, execute, period-over-period (pop), pop-chart                                 | Generates SQL from metric definition, executes against Icebox                     |
| **Follow**       | follow, unfollow, followed list, follow status, bulk statuses, followers                       | User-facing subscription system                                                   |
| **Search (S2S)** | indexDataCount, indexData, indexDataByIds, search, permission filter                           | Service-to-service only — not relevant for BFF                                    |

### Core Model: `Metric`

A Metric is a saved, named aggregation over a Domo datasource:

```
Metric {
  id: number
  name: string
  description?: string
  owner: number                          // Domo user ID
  ownerDisplayName?: string
  tags?: string[]
  datasourceId: string                   // UUID of the backing dataset
  dataSourceName?: string
  dateColumn?: string                    // column used for time-series
  preferredDateGrain?: DateTimeElement   // e.g. DAY, WEEK, MONTH
  datasetDateGrain?: DateTimeElement
  calendarType?: STANDARD | FISCAL
  dimensions?: string[]                 // group-by columns (may include beast modes)
  aggregation?: { function, value, alias }
  filters?: Expression[]                // WHERE clauses (JSqlParser serialized)
  aggregatedFilters?: Expression[]       // HAVING clauses
  legacyFilters?: Filter[]
  dateRangeFilter?: DateRangeFilter
  properties?: Record<string, unknown>
  format?: { sentiment?, type?, columnFormat? }
  cumulativeType?: RUNNING_TOTAL | NON_CUMULATIVE
  created?: ISO date
  modified?: ISO date
}
```

**Aggregation functions:** SUM, AVG, COUNT, MIN, MAX (each with DISTINCT variant), DOMO_BEAST_MODE.

**Sentiment:** Polymorphic via `@type` discriminator — RANGE (top/bottom thresholds), THRESHOLD (single pivot), TREND (upward = positive/negative).

### Request Models

- **MetricSearchFilters** — paginated filter/sort (nameContains, filters by OWNER/TAGS/DATASOURCE_ID, orderBy, followed flag, limit/offset)
- **MetricSqlRequest** — dimensions override, aggregation override, dateGrain, orderBy, calendarType, dateRangeFilter, filters
- **MetricSqlPeriodRequest** — extends SqlRequest with `periodDateRangeFilters` map (named periods) and `annotationDate` flag
- **MetricPreviewRequest** — wraps `{ metric, sqlRequest }` for unsaved metric dry-runs

### Response Models

- **MetricSearchResponse** — `{ metrics[], totalCount, count, limit, offset }`
- **MetricSql** — `{ metric, sql (string), select (AST) }`
- **MetricPreviewResponse** — `{ metricSql, queryResultSet }`
- **QueryResultSet** — Icebox query results (columns + rows)
- **BulkDeleteResult** — `{ deletedMetricIds[], errors[] }`

### Auth

All user-facing endpoints require `HAS_AUTHORITY_AUTOMATED_INSIGHTS`. The backend also checks a `metrics` feature switch — if disabled, all endpoints return 400. Huckleberry proxies with the user's Gatekeeper JWT, so Domo enforces auth.

## Proposed Solution

Pure proxy through `DomoProxyService`, same pattern as `datasources/`. Huckleberry does not replicate SQL generation or Icebox query logic — it forwards requests and returns responses.

### File Structure

```
src/metrics/
  metrics.module.ts
  metrics.controller.ts
  metrics.service.ts
  dto/
    metric.dto.ts           — Metric, Aggregation, MetricFormat, Sentiment types
    metric-search.dto.ts    — MetricSearchFilters, MetricSearchResponse
    metric-sql.dto.ts       — MetricSqlRequest, MetricSqlPeriodRequest, MetricSql
    metric-preview.dto.ts   — MetricPreviewRequest, MetricPreviewResponse
```

### Phased Rollout

#### Phase 1 — Core CRUD + Execute

The minimum set an agent needs to discover, inspect, and run metrics.

| BFF Route                   | Method | Upstream Path                              | Purpose                   |
| --------------------------- | ------ | ------------------------------------------ | ------------------------- |
| `/metrics`                  | GET    | `/api/content/v1/metrics`                  | List all                  |
| `/metrics/:id`              | GET    | `/api/content/v1/metrics/:id`              | Get by ID                 |
| `/metrics`                  | POST   | `/api/content/v1/metrics`                  | Create                    |
| `/metrics/:id`              | PUT    | `/api/content/v1/metrics/:id`              | Update                    |
| `/metrics/:id`              | DELETE | `/api/content/v1/metrics/:id`              | Delete                    |
| `/metrics/filter`           | POST   | `/api/content/v1/metrics/filter`           | Search/filter (paginated) |
| `/metrics/datasource/:dsId` | GET    | `/api/content/v1/metrics/datasource/:dsId` | By datasource             |
| `/metrics/preview`          | POST   | `/api/content/v1/metrics/preview`          | Preview SQL + execute     |
| `/metrics/:id/sql`          | POST   | `/api/content/v1/metrics/:id/sql`          | Get generated SQL         |
| `/metrics/:id/execute`      | POST   | `/api/content/v1/metrics/:id/execute`      | Execute metric            |
| `/metrics/:id/execute/pop`  | POST   | `/api/content/v1/metrics/:id/execute/pop`  | Period-over-period        |

11 endpoints. Service methods are one-liner proxy calls.

**Validation:** DTOs use `class-validator` decorators for request bodies (MetricSearchFilters, MetricSqlRequest, MetricSqlPeriodRequest, MetricPreviewRequest). Path params validated as number/string via NestJS pipes. Response types are passthrough — no transformation.

**Delete query param:** The upstream `DELETE /:id` accepts `?hardDelete=true|false` (default false). Expose as optional query param.

#### Phase 2 — Follow/Unfollow

Add if the UI needs user subscription to metrics. 7 additional endpoints:

- `POST /metrics/follow/:id`, `DELETE /metrics/follow/:id`
- `GET /metrics/followed`, `GET /metrics/followed/ids`
- `GET /metrics/follow/status/:id`, `POST /metrics/follow/statuses`
- `GET /metrics/followed/:id/users`

#### Phase 3 — Agent Toolkit

Register a `metrics` toolkit exposing tool functions for agent conversations:

- `list_metrics` — list or filter metrics
- `get_metric` — get by ID
- `execute_metric` — run a metric and return results
- `preview_metric` — preview an unsaved metric definition
- `create_metric` / `update_metric` — CRUD (gated by agent permissions)
- `suggest_metrics` — AI-generated candidates for a datasource (Phase 4)

This turns metrics into a first-class capability agents can invoke during reasoning.

#### Phase 4 — AI-Assisted Metric Suggestion with Confidence Scoring

Generate candidate metric definitions from a dataset's schema, validate them mechanically, score them with an AI judge, and present ranked options for the user to accept. Every primitive already exists in the BFF:

| Primitive             | Existing surface                                                                            | Role in pipeline                                            |
| --------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Dataset schema        | `GET /datasources/:id/schema` → `/api/data/v3/datasources/{id}/schema`                      | Column names/types seed generation and validate candidates  |
| Structured generation | `POST /ai/text/generation` (`/api/ai/v1/text/generation`) with `responseFormat` JSON schema | Emit N candidate metric definitions as validated JSON       |
| Schema-aware NL→SQL   | `POST /ai/text/sql` with `dataSourceSchemas[]` (name/type/description/sampleValues)         | Optional cross-check of a candidate's intent                |
| Dry-run execution     | `POST /metrics/preview` (`/api/content/v1/metrics/preview`)                                 | Ground truth: does the candidate compile and execute?       |
| Agent execution       | `POST /agents/:id/execute/streaming`                                                        | Future judge option — streaming-only today (see Decision 5) |

##### New Endpoints

| BFF Route                | Method | Purpose                                                               |
| ------------------------ | ------ | --------------------------------------------------------------------- |
| `/metrics/suggest`       | POST   | `{ datasourceId, count?, focus? }` → ranked, scored candidate metrics |
| `/metrics/suggest/score` | POST   | Score a single (user-drafted or edited) metric definition before save |

Both are **orchestration endpoints**, not proxies — the first non-passthrough logic in this module. Implemented as a `MetricSuggestionService` in `src/metrics/` composing `DataSourcesService`, `AiServicesService`, and `MetricsService` (requires exporting the first two from their modules).

##### Pipeline

1. **Fetch schema** for `datasourceId`; map columns to `AIDataSourceSchemaDto` shape.
2. **Generate candidates** via `text/generation` with a JSON `responseFormat` constraining output to a restricted Metric subset: `name`, `description`, `aggregation` (function + column), `dimensions`, `dateColumn`, `preferredDateGrain`, optional `sentiment`. **No `filters`/`aggregatedFilters` in v1** — LLM-emitted JSqlParser JSON is fragile (ties to Decision 1; a simplified filter DSL unlocks filtered candidates later). The optional `focus` param is a natural-language hint ("revenue metrics", "customer churn") injected into the prompt.
3. **Mechanical validation** (deterministic, free): referenced columns exist in schema; aggregation function is type-compatible (SUM/AVG only on numerics); `dateColumn` is date-typed. Failures are dropped or returned flagged.
4. **Dry-run** each survivor through `POST /metrics/preview`. Capture: success/failure, row count, all-null aggregate detection, and a small result sample.
5. **AI confidence judgment**: second `text/generation` call (JSON `responseFormat`) given the candidate + schema + preview sample, returning `{ confidence: 0–1, rationale, caveats[] }`. Judged against: semantic plausibility of the aggregation, whether the preview results look sane, name/description accuracy.
6. **Return ranked candidates**: `{ metric, confidence, rationale, validation: { schemaValid, previewOk, rowCount }, previewSample }`, sorted by composite score. Accepting a candidate is a plain `POST /metrics` — no new create path.

##### Confidence model

Composite, not raw LLM opinion:

- **Hard gates** (deterministic): schema validity and preview executability. A candidate that fails preview is never presented as a top option regardless of judge score.
- **Judge score** (0–1 + rationale): only differentiates candidates that passed the gates.
- Response carries all components separately so the UI can explain _why_ a candidate is trusted, not just a bare number.

##### Cost/latency bounds

- Cap candidates at ~5 per request (`count` param, server-enforced max).
- Run preview + judge calls concurrently per candidate.
- Total: 1 schema fetch + 1 generation + ≤5 previews + ≤5 judge calls per suggest request. Consider a per-datasource short-TTL schema cache if the UI calls repeatedly.

##### Known constraints

- The `metrics` feature switch and `HAS_AUTHORITY_AUTOMATED_INSIGHTS` still gate preview — suggestion inherits the same failure mode (400 when disabled).
- AI Services calls run under the user's Gatekeeper JWT, so AI feature enablement in the instance is also required.

## Decisions to Make

1. **Filters/Expression passthrough vs. simplification.** The upstream `filters` and `aggregatedFilters` fields are JSqlParser `Expression` objects serialized as JSON. Options:
   - **(a) Full passthrough** — BFF forwards whatever the client sends, typed as `unknown[]`. Simplest, but the UI/agent caller must know the JSqlParser JSON shape.
   - **(b) Simplified filter builder** — BFF accepts a simpler filter DSL (column/operator/value) and translates to JSqlParser JSON. More work, but friendlier for agent callers.
   - **Recommendation:** Start with (a). If agent tool callers struggle with the raw shape, add (b) as a thin translation layer in Phase 3.

2. **Response envelope.** Huckleberry uses a `ResponseEnvelopeInterceptor`. Confirm that wrapping metric responses doesn't break the frontend consumer's expectations (it shouldn't — all other proxied endpoints are already enveloped).

3. **`QueryResultSet` passthrough.** The execute endpoints return Icebox `QueryResultSet` (columns metadata + row arrays). Passthrough as `unknown` or define a lightweight TS interface? Recommendation: define a minimal interface (`{ columns: { name, type }[]; rows: unknown[][] }`) for type safety, but don't validate — let Domo be the source of truth.

4. **Judge implementation: AI Services vs. Domo agent.** (Phase 4)
   - **(a) `text/generation` with JSON `responseFormat`** — synchronous, structured, works today. Recommended v1.
   - **(b) Domo agent as judge** — richer (agent can call tools, inspect data itself), but the BFF's agent execution is streaming-only pass-through. Requires a buffered `executeCollect()` helper in `AgentsService` that consumes the SSE stream server-side and extracts the final message. Also requires a designated judge agent to exist in the instance (discovery/config question).
   - **Recommendation:** implement scoring behind a small `ConfidenceScorer` interface so (b) can swap in without touching the pipeline.

5. **Suggestion determinism.** LLM generation is nondeterministic — same datasource may yield different candidates per call. Acceptable for a "suggest options" UX; if reproducibility matters later, persist suggestion sets or seed prompts with prior accepted metrics.

## Excluded

- **S2S / search / permission endpoints** — these are for inter-service communication (search indexing). Not relevant for a BFF.
- **Unarchive / change owner** — administrative operations. Can add later if needed.
- **Bulk delete** — can add in Phase 1 if needed, but omitted from initial cut for simplicity.

## Verification

- Phase 1: `pnpm test` passes, `pnpm lint` passes, manual curl against a running Domo instance confirms round-trip for create → get → execute → delete. ✅ Done.
- Phase 2: Follow/unfollow round-trip test.
- Phase 3: Agent can invoke `execute_metric` in a conversation and receive tabular results.
- Phase 4: Unit tests for mechanical validation (column existence, type compatibility) with mocked schema; integration test that `POST /metrics/suggest` against a real datasource returns ≥1 candidate that passes preview; a deliberately bad candidate (nonexistent column) is gated out. Accepted candidate round-trips through `POST /metrics` unchanged.
