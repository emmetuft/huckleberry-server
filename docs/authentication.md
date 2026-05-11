# Huckleberry Authentication

## What we're doing (the layman version)

Huckleberry is a backend that sits between client apps and a bunch of Domo services. Today every request is waved through with a dev token or a simple header check — fine for development, not fine for anything real.

We're going to put a proper lock on the front door. Domo has a new in-house OAuth 2.1 service called **Gatekeeper** (it replaces the older Heimdall flow). Gatekeeper hands out signed access tokens that prove *who* is calling and *what* they're allowed to do. Huckleberry's job is to:

1. **Check the token on every request** — make sure it's real, not expired, and was signed by Gatekeeper.
2. **Read who the user is** out of the token (user id, tenant, scopes) and make that available to the rest of the app.
3. **Pass the token downstream** when we call other Domo services, so the user's identity flows end-to-end instead of being laundered through a service account.

We are a *consumer* of Gatekeeper, not a builder of it. We don't issue tokens, we don't host login pages, we don't manage signing keys. We verify what shows up in the `Authorization` header and act on it.

The token itself is a JWT signed with ES256. Gatekeeper publishes its public keys at `/oauth2/jwks` on the tenant host (`https://{customer}.domo.com/oauth2/jwks`). We fetch those keys, cache them, and use them to verify signatures locally — no network round-trip per request.

Scopes (e.g. `ai:execute`, `dataset:data:read`) are the unit of permission. Each endpoint declares the scope it requires; the guard rejects calls whose token doesn't carry it.

## Implementation plan

Sprint 1 lays the seam so the rest of the project can keep moving under the dev-token guard while we wait for Gatekeeper to be reachable from our environment. Real verification flips on later.

1. **Add a JWKS client** → verify: unit test fetches keys from a mock JWKS URL and caches them with TTL + `kid` lookup.
2. **Write a `GatekeeperAuthGuard`** that verifies JWT signature, `iss`, `aud`, `exp`, and extracts claims → verify: spec covers valid token, expired token, wrong issuer, unknown `kid`, missing/invalid signature.
3. **Define a `RequestPrincipal`** type (user id, tenant, scopes, raw token) and attach it to `request.user` → verify: controller test reads the principal off the request.
4. **Add a `@Scopes(...)` decorator + scope check** in the guard → verify: spec rejects tokens missing a required scope with `403`, accepts when present.
5. **Wire config** (`GATEKEEPER_ISSUER`, `GATEKEEPER_JWKS_URI`, `GATEKEEPER_AUDIENCE`) into `AppConfig` with validation → verify: app fails fast on boot if any are missing in non-dev.
6. **Keep `DomoAuthGuard` as the active guard** behind an env flag (`AUTH_PROVIDER=dev|gatekeeper`) so S2–S3 keep shipping while Gatekeeper isn't reachable yet → verify: e2e test passes under both modes.
7. **Forward the bearer token to `DomoProxyService`** so downstream Domo calls carry the caller's identity instead of a service token → verify: integration test asserts the `Authorization` header reaches the proxied request.
8. **Map Gatekeeper error shapes** (`invalid_token`, `insufficient_scope`) to NestJS exceptions via the existing `DomoExceptionFilter` pattern → verify: spec confirms `WWW-Authenticate` header is set on 401/403.
9. **Flip `AUTH_PROVIDER=gatekeeper` in Sprint 4** once Gatekeeper is reachable; remove the dev guard after a soak period → verify: smoke test against a real Gatekeeper-issued token hits a protected endpoint and returns 200.

## Two endpoint categories

Huckleberry's endpoints split into two camps based on where the data actually lives:

- **Category A — Domo-proxied.** The request is forwarded (or fans out) to a Domo service. The user's Gatekeeper token rides along; the downstream service makes the real access decision. Scope gating uses Gatekeeper's Domo catalog (`ai:*`, `dataset:*`, `identity:*`).
- **Category B — Huckleberry-owned (Aurora MySQL).** We're the system of record. The data lives in our database — personas, chat sessions, MCP server registrations — keyed by the caller's Domo user id. There is nothing downstream of us for these calls.

**Both categories still require a valid Gatekeeper token.** The token is our only source of identity (`sub`, `iss`/tenant); without it we don't know whose Aurora rows to return. The split is about *what scope gates the call*, not whether auth happens.

### Category A: Domo-proxied endpoints (Gatekeeper-scope gated)

Scope per route. The bearer token is forwarded via `DomoProxyService`; downstream Domo enforces fine-grained access on top.

| Huckleberry route | Downstream Domo route | Scope |
|---|---|---|
| `GET /identity` | `GET /api/content/v3/users/me` | `identity:read` |
| `GET /users` | `GET /api/identity/v1/users` | `identity:read` |
| `GET /users/:id` | `GET /api/content/v3/users?id={id}` | `identity:read` |
| `GET /groups` | `GET /api/content/v2/groups/grouplist` | `identity:read` |
| `GET /groups/:id` | `GET /api/content/v2/groups/{id}` | `identity:read` |
| `GET /agents` | `GET /api/ai/v1/agents` | `ai:read` |
| `GET /agents/:agentId` | `GET /api/ai/v1/agents/{agentId}` | `ai:read` |
| `POST /agents` | `POST /api/ai/v1/agents` | `ai:write` |
| `POST /agents/search` | `POST /api/ai/v1/agents/search` | `ai:read` |
| `POST /agents/refresh` | *(triggers re-pull of `/api/ai/v1/agents`)* | `ai:read` |
| `PUT /agents/:agentId` | `PUT /api/ai/v1/agents/{agentId}` | `ai:write` |
| `DELETE /agents/:agentId` | `DELETE /api/ai/v1/agents/{agentId}` | `ai:write` |
| `PATCH /agents/:agentId/context` | `PATCH /api/ai/v1/agents/{agentId}/context` | `ai:write` |
| `POST /agents/:agentId/execute/streaming` | `POST /api/ai/v1/agents/{agentId}/execute/streaming` | `ai:execute` |
| `POST /agents/:agentId/resume/streaming` | `POST /api/ai/v1/agents/{agentId}/resume/streaming` | `ai:execute` |
| `POST /huckleberry/execute/streaming` | `POST /api/ai/v1/agents/{huckleberryAgentId}/execute/streaming` | `ai:execute` |
| `POST /huckleberry/resume/streaming` | `POST /api/ai/v1/agents/{huckleberryAgentId}/resume/streaming` | `ai:execute` |
| `POST /ai/generate` | `POST /api/ai/v1/text/generation` *(or `/text/chat[/streaming]`)* | `ai:execute` |
| `POST /ai/summarize` | `POST /api/ai/v1/text/summarize` | `ai:execute` |
| `POST /ai/sql` | `POST /api/ai/v1/text/sql` | `ai:execute` |
| `GET /toolkits` | `GET /api/ai/v1/toolkits` | `ai:read` |
| `POST /sessions` (search) | `POST /api/ai/v1/search/sessions` | `ai:read` |
| `GET /sessions/:sessionId` | `GET /api/ai/v1/sessions/{sessionId}` | `ai:read` |
| `GET /sessions/:sessionId/events` | `GET /api/ai/v1/sessions/{sessionId}/events` | `ai:read` |
| `DELETE /sessions/:sessionId` | `DELETE /api/ai/v1/sessions/{sessionId}` | `ai:write` |
| `GET /connectors/:databaseId/image` | `GET /api/data/v1/connectors/display/{databaseId}/images/320.png` | `dataset:meta:read` |
| `POST /connectors` (search) | `POST /api/search/v1/query` | `dataset:meta:read` |
| `GET /datasources` | `GET /api/data/v3/datasources` | `dataset:meta:read` |
| `GET /datasources/:id/schema` | `GET /api/data/v3/datasources/{id}/schema` | `dataset:meta:read` |
| `POST /datasources/:id/data` | `POST /api/query/v1/execute/{id}` | `dataset:data:read` |
| `POST /graph/nodes` | `POST /api/recall/v1/...` *(graph device)* | `dataset:meta:read` *(see open Q4)* |

### Category B: Huckleberry-owned endpoints (Aurora MySQL)

These read and write huckleberry's own tables in Aurora. They require an authenticated principal but do not gate on a Domo-product scope — there's no Domo resource downstream to align with. We propose a **single coarse scope, `huckleberry:access`**, declared at the application level (not in the Domo catalog), to express "this token may use the huckleberry app." Row-level access is enforced by `customer_id + sub` filtering in the service layer (see [Multi-tenant isolation](#multi-tenant-isolation-in-aurora)).

> Personas and MCP servers are in-memory stubs today (`new Map<>()` in `personas.service.ts` and `mcp.service.ts`). The plan is to back them with Aurora MySQL — these are the endpoints that will land in Category B once that's wired up.

| Huckleberry route | Backing table(s) | Scope |
|---|---|---|
| `GET /personas` | `personas` | `huckleberry:access` |
| `POST /personas` | `personas` | `huckleberry:access` |
| `GET /personas/default` | `personas` | `huckleberry:access` |
| `GET /personas/:id` | `personas` | `huckleberry:access` |
| `PUT /personas/:id` | `personas` | `huckleberry:access` |
| `DELETE /personas/:id` | `personas` | `huckleberry:access` |
| `PATCH /personas/:id/default` | `personas` | `huckleberry:access` |
| `GET /persona/:userId` | `personas` | `huckleberry:access` |
| `POST /persona/:userId` | `personas` | `huckleberry:access` |
| `GET /mcp/servers` | `mcp_servers` | `huckleberry:access` |
| `POST /mcp/servers` | `mcp_servers` | `huckleberry:access` |
| `GET /mcp/servers/:id` | `mcp_servers` | `huckleberry:access` |
| `PUT /mcp/servers/:id` | `mcp_servers` | `huckleberry:access` |
| `DELETE /mcp/servers/:id` | `mcp_servers` | `huckleberry:access` |
| `PATCH /mcp/servers/:id/toggle` | `mcp_servers` | `huckleberry:access` |
| `POST /mcp/servers/:id/test` | `mcp_servers` | `huckleberry:access` |
| `POST /mcp/servers/:id/sync` | `mcp_servers`, `mcp_tools` | `huckleberry:access` |
| `GET /mcp/tools` | `mcp_tools` | `huckleberry:access` |
| `POST /mcp/tools/execute` | `mcp_servers`, `mcp_tools` | `huckleberry:access` |
| `GET /mcp/oauth2/authorize/:serverId` | `mcp_oauth_tokens` | `huckleberry:access` |
| `POST /mcp/oauth2/revoke/:serverId` | `mcp_oauth_tokens` | `huckleberry:access` |
| `GET /mcp/oauth2/status/:serverId` | `mcp_oauth_tokens` | `huckleberry:access` |
| `POST /mcp/oauth2/discover/:serverId` | `mcp_oauth_tokens` | `huckleberry:access` |

Notes:
- `customer_id` (parsed from the token's `iss`) and `sub` are the only legal row filters. The guard rejects any token whose `iss` doesn't resolve to a known tenant before any query runs.
- `POST /mcp/tools/execute` is borderline — it runs code, but the runtime is *ours* (no Domo credit consumption). Keep it under `huckleberry:access`. If a tool call routes through Domo's mako execute endpoints, *that* downstream call uses the user's Gatekeeper token and the Domo side enforces `ai:execute`.
- `GET /health` is public — no token, no scope.

### Client-side scope request

The frontend (`~/dev/huckleberry`) registers once via DCR and requests:

```
huckleberry:access
ai:read ai:write ai:execute
identity:read
dataset:meta:read dataset:meta:write dataset:data:read
```

Eight scopes total. The consent screen shows what the user is granting the huckleberry app: read their Domo identity, read/write Domo agents, run AI, read dataset metadata and data, plus access huckleberry's own state.

### Multi-tenant isolation in Aurora

Category B tables are shared across all customers. **Cross-customer leakage is the highest-severity bug class in this system** — one missing `WHERE customer_id = ?` and customer A reads customer B's chat history. We address this with multiple overlapping layers; any one of them catching a bad query is enough.

**Identifying the tenant.** Gatekeeper access tokens carry `iss = https://{customer}.domo.com`. The guard parses the customer subdomain out of `iss` once, validates it against a known-tenants check, and exposes it as `principal.customerId` (a stable string like `cust1`, not the hostname). The raw `iss` is also kept for audit. Tokens whose `iss` doesn't parse to a known tenant are rejected at the guard — no Aurora query ever runs.

**Layer 1 — Schema.** Every Category B table has a non-nullable `customer_id VARCHAR(64)` column. Every index that supports a user-facing query has `customer_id` as its **leading column** (e.g., `(customer_id, user_id, created_at)` on `sessions`). Primary keys are `(customer_id, id)` composite — never a bare UUID. This makes a query without `customer_id` either an index scan or a full table scan; the next layer catches both.

**Layer 2 — Repository wrapper.** All Category B data access goes through a `TenantScopedRepository<T>` that takes `customerId` in its constructor and injects `customer_id = ?` into every `SELECT`, `UPDATE`, and `DELETE` it generates. There is no method that issues an unscoped query. Raw query builders (`dataSource.query(...)`) are linted out of `src/personas`, `src/sessions`, `src/mcp` via an ESLint rule. The repository's constructor is private; it can only be obtained through a request-scoped factory that requires the `RequestPrincipal`.

**Layer 3 — Service-method contract.** Every service method that touches Aurora takes `principal: RequestPrincipal` as its first argument (not optional, not a `customerId` string that could be forged from a body). The method passes `principal.customerId` into the repository. Code review rule: a service method that touches Aurora and doesn't accept a `RequestPrincipal` is rejected.

**Layer 4 — Defense at the connection.** On each request, before any query, we issue `SET @huckleberry_customer_id = ?` on the connection. Aurora MySQL doesn't have native row-level security, but we use this session variable in `CHECK` constraints on write paths (`CHECK (customer_id = @huckleberry_customer_id)` on inserts/updates via triggers). A bug that bypasses the repository wrapper still trips the trigger and the write fails with a constraint error.

**Layer 5 — Path/body cross-checks.** When a path parameter or body field names a `customerId`, `userId`, or resource id that belongs to a customer, the guard or DTO validator asserts it matches `principal.customerId` and `principal.sub`. A request from customer A trying to `GET /sessions/{id}` where `{id}` belongs to customer B returns `404 Not Found` (not `403` — we don't leak existence).

**Layer 6 — Tests.** Every Category B service ships with a `cross-tenant.spec.ts` test that seeds two customers, then asserts every read/write/delete operation by customer A's principal returns zero rows / no effect against customer B's data. CI fails if any Category B service is missing this spec (enforced by a simple file-presence check).

**Layer 7 — Audit logging.** Every Category B request logs `(customer_id, sub, route, row_count_returned)` at INFO. Any query that returns zero rows after a successful auth + scope check logs at WARN (likely a cross-tenant attempt or a stale id). A daily job alerts on any single user generating >N WARN-level cross-tenant hits.

The combination is overkill on purpose. Layers 2 and 3 catch the realistic case (developer forgets `customer_id`). Layer 4 catches a clever bypass. Layer 5 catches enumeration. Layer 6 prevents regression. Layer 7 makes a breach observable in real time.

### Guard implementation

- `GatekeeperAuthGuard` verifies the JWT on every request (both categories) and attaches `RequestPrincipal` (user id, tenant, scopes, raw token).
- `@Scopes(...)` decorator per route. The guard rejects missing scope with `403 insufficient_scope` (RFC 6750).
- `@Public()` bypasses the guard (only `/health` today).
- For Category B, services use the principal's `sub` and tenant to constrain every Aurora query — defense-in-depth even though the scope check already passed.

## Open questions (for the nitty-gritty pass)

1. **`huckleberry:access` — one scope or split?** One coarse scope today; split into `huckleberry:read`/`:write` only if a real use case appears for read-only third-party clients. The frontend doesn't need the split.
2. **Where does `huckleberry:access` live?** Not in Gatekeeper's Domo catalog. Options: (a) propose it to the Gatekeeper team for the catalog, (b) declare it locally and have our guard accept it without server-side validation. (a) is cleaner long-term; (b) unblocks MVP.
3. **Aurora row scoping** — confirm every Category B service filters by `tenant + sub` at the query layer. The guard already verified identity, but query-level filtering is the actual safety net against cross-tenant leakage.
4. **Graph queries** — `POST /graph/nodes` reads Domo's ontology graph (Category A). Catalog has no `graph:*`; `dataset:meta:read` is least-bad. Raise with Gatekeeper team if graph grows.
5. **Personas in Category B is right** — they're huckleberry-owned user prefs in Aurora, not Domo identity. Confirmed by the split.
6. **`POST /mcp/tools/execute`** — Category B today (we run the tools). If/when tool execution routes through Domo mako execute endpoints, move to Category A with `ai:execute`.
7. **Legacy Heimdall tokens during transition** — accept both, or hard cutover at Sprint 4? Default to hard cutover.
8. **Token forwarding to Domo** — bearer pass-through, or token-exchange (RFC 8693)? Pass-through unless `aud` mismatch forces exchange.
