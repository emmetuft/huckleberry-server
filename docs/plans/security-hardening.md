# Security Hardening Implementation Plan — Huckleberry Server

## Context

The huckleberry-server threat model (2026-06-23) identified 8 High, 5 Medium, and 4 Low findings (17 total). The server is VPN-accessible with self-service signup — authorization findings are exploitable today by any internal user. The most critical: any authenticated user can read/write any other user's persona (IDOR → stored prompt injection) and see every MCP server's bearer tokens (cross-tenant disclosure).

This plan remediates 15 of 17 findings in 8 dependency-ordered phases. Each phase is an independent PR. Two findings are deferred as accepted risk (see Lower Priority section): THR-TB04-T-01 (Cypher passthrough) and THR-TB08-I-01 (dev secrets in compose). Phase 1 (tenant scoping) is foundational — Phase 4 (MCP) depends on it. All others are parallel-safe.

---

## External Dependencies Summary

Most phases are pure code changes. Only Phase 6 has a hard external blocker:

| Phase | External dependency | Owner | Blocking? |
|-------|--------------------|-------|-----------|
| 1 | DB migrations (run automatically on deploy) | — | No — handled by deploy pipeline |
| 3 | None — single pod, in-memory throttler | — | No |
| 6 | **KMS key creation + IAM policy** | Adam | **Yes — cannot implement production encryption without the key** |
| 6 | `@aws-sdk/client-kms` npm package | Dev | No (trivial `pnpm add`) |
| 6 | `KMS_KEY_ARN` env var in deployment manifests | Infra | Yes — needed for production |
| 7 | `CORS_ORIGIN` env var in deployment manifests | Dev/Infra | Soft — defaults to `*` locally, must be set for production |
| 8 | Dedicated CloudWatch log group (optional) | Infra | No — stdout works |

**Action item for Adam:** Create a symmetric AES_256 KMS key (tagged `service=huckleberry`, `purpose=token-encryption`) and grant the huckleberry pod IAM role `kms:GenerateDataKey` + `kms:Decrypt`. This unblocks Phase 6.

---

## Phase 1: Tenant-Scoped Authorization

**Threat IDs:** THR-TB03-E-01 (persona IDOR), THR-TB03-I-01 (cross-user disclosure)

**External prerequisites:**

| Dependency | Owner | What's needed |
|------------|-------|---------------|
| None | — | Drizzle migrations run automatically on deploy. Locally via docker-compose MySQL. |

**What changes:**

1. **Extend ALS context** — Add `customerId` and `userId` to `DomoRequestContext`:
   - File: `src/common/auth/domo-request-context.ts`
   - New shape: `{ bearer, targetHost, customer?, customerId, userId }`

2. **Propagate tenant identity from interceptor** — `DomoContextInterceptor.resolve()` already fetches the link (which has `customerId`). Pass it through:
   - File: `src/common/auth/domo-context.interceptor.ts`
   - In `resolve()`: return `{ bearer, targetHost, customerId: link.customerId, userId: principal.userId }`
   - In dev bypass: read `DEV_INSTANCE_CUSTOMER_ID` and the synthetic principal's userId

3. **Create `personas` Drizzle table** with composite PK `(customer_id, user_id, id)`:
   - File: `src/common/db/schema.ts` — add `personas` table matching the documented schema
   - New file: `src/common/db/repositories/mysql-persona.repository.ts` — implements `PersonaRepository` interface
   - All queries filter by `(customerId, userId)` read from ALS

4. **Create `mcp_servers` Drizzle table** with composite PK `(customer_id, user_id, id)`:
   - File: `src/common/db/schema.ts` — add `mcpServers` table
   - New file: `src/common/db/repositories/mysql-mcp.repository.ts`

5. **Rewrite `PersonasService`** — replace in-memory Map with MySQL repository:
   - File: `src/personas/personas.service.ts`
   - Inject repository, read `(customerId, userId)` from ALS context on every operation

6. **Rewrite `PersonaCompatController`** — remove `:userId` path param:
   - File: `src/personas/persona-compat.controller.ts`
   - `GET /api/persona` → derives identity from ALS
   - `POST /api/persona` → validates body via DTO with `whitelist: true`

7. **Scope `PersonasController`** — all CRUD routes must filter by `(customerId, userId)`:
   - File: `src/personas/personas.controller.ts`
   - `GET /personas` (`findAll`) → scoped to current user, not global
   - `GET /personas/:id`, `PUT /personas/:id`, `DELETE /personas/:id`, `PATCH /personas/:id/default` → verify ownership via composite key lookup
   - Decision: consolidate with `PersonaCompatController` into one controller, or scope both independently

8. **Rewrite `McpService`** — replace in-memory Map with MySQL repository:
   - File: `src/mcp/mcp.service.ts`
   - All operations scoped by `(customerId, userId)` from ALS

9. **Scope or persist MCP OAuth tokens** — `McpService.oauthTokens` (in-memory Map keyed by server ID) holds live access tokens for third-party MCP servers. Must be tenant-scoped at minimum; persist to MySQL alongside server configs.

10. **Add Drizzle migration** for new tables

11. **E2e tests** — `test/authz-scoping.e2e-spec.ts`:
   - User A creates persona → User B cannot read it (404)
   - User A registers MCP server → User B's list doesn't include it
   - Credential fields stripped from MCP list responses

**Key patterns to reuse:**
- `MysqlUserRepository` pattern: interface + DI symbol + Drizzle impl (from `src/common/db/repositories/`)
- `uuidToBinary()`/`binaryToUuid()` helpers for UUID columns
- `domoRequestContext.getStore()` to read ALS in repositories

---

## Phase 2: Unified Session Guard with CSRF

**Threat IDs:** THR-TB01-T-01 (missing CSRF on Category A), THR-TB02-T-02 (non-constant-time compare)

**What changes:**

1. **Create `SessionAuthGuard`** — single guard replacing both `DomoAuthGuard` and `HuckleberryAuthGuard`:
   - New file: `src/common/guards/session-auth.guard.ts`
   - Validates `hb_session` cookie → `SessionService.verifyAndTouch()`
   - On POST/PUT/PATCH/DELETE: validates CSRF via `crypto.timingSafeEqual`
   - **Important:** `timingSafeEqual` throws `RangeError` on length mismatch — reject immediately if `Buffer.byteLength(header) !== Buffer.byteLength(stored)` before calling
   - Checks `Origin` / `Sec-Fetch-Site` as secondary signal
   - Supports `@Public()` decorator (existing pattern)
   - Supports new `@SkipCsrf()` decorator for future webhook routes
   - Dev-token bypass preserved (same conditions)

2. **Create `@SkipCsrf()` decorator**:
   - New file: `src/common/decorators/skip-csrf.decorator.ts`

3. **Replace all `@UseGuards(DomoAuthGuard)` and `@UseGuards(HuckleberryAuthGuard)`** with `@UseGuards(SessionAuthGuard)` across all controllers

4. **Delete** `src/common/guards/domo-auth.guard.ts` and `src/common/auth/huckleberry-auth.guard.ts`

5. **Remove `PersonaCompatController`** (`src/personas/persona-compat.controller.ts`) — the frontend should migrate to the full personas API (`PersonasController`) which derives identity from the session and supports multiple personas. The compat shim was introduced in Phase 1 as a non-breaking bridge; Phase 2's guard unification is the right moment to complete the frontend migration and remove the shim.

6. **Update tests** — `domo-auth.guard.spec.ts` → rename/rewrite for `SessionAuthGuard`

7. **E2e tests**:
   - POST to any Category A endpoint without CSRF → 403
   - GET requests pass without CSRF
   - `@SkipCsrf()` annotated route accepts POST without CSRF

**⚠️ Frontend coordination required:** Currently only `HuckleberryAuthGuard` routes (auth/link) enforce CSRF — the SPA sends `X-CSRF-Token` only on those requests. Extending CSRF to all mutating Category A routes (agents, MCP, personas, datasources) will 403 the SPA unless it sends the token on ALL POST/PUT/PATCH/DELETE. This is a cross-repo deployment dependency — the frontend must be updated simultaneously or behind a feature flag.

---

## Phase 3: Rate Limiting

**Threat IDs:** THR-TB01-D-01 (no rate limiting), THR-TB01-I-01 (timing oracle)

**External prerequisites:**

| Dependency | Owner | What's needed |
|------------|-------|---------------|
| Redis / ElastiCache | — | **Not needed.** Single pod deployment — in-memory throttler storage is sufficient. No external dependency. |

**What changes:**

1. **Install `@nestjs/throttler`** — add to `package.json`

2. **Register `ThrottlerModule`** in `AppModule`:
   - File: `src/app.module.ts`
   - Global default: 200 req/min per IP
   - Named configs: `auth-email` (3/15min per email), `auth-ip` (10/min per IP), `consume` (20/min per IP)

3. **Configure `trust proxy`** — required for correct IP resolution behind EKS/ALB:
   - File: `src/main.ts`
   - `app.set('trust proxy', 1)` (or the specific ALB CIDR if tighter control needed)
   - Without this, `req.ip` resolves to the load balancer IP — all users share a single rate-limit bucket

4. **Add throttler config** to `configuration.ts`:
   - File: `src/common/config/configuration.ts`
   - Env vars: `THROTTLE_GLOBAL_LIMIT`, `THROTTLE_AUTH_EMAIL_LIMIT`, etc.

5. **Apply per-endpoint throttling** on auth routes:
   - File: `src/auth/auth.controller.ts`
   - `@Throttle('auth-email')` on `/signup`, `/signin/request`
   - `@Throttle('consume')` on `/signin`

6. **Normalize auth timing** — both known and unknown email paths must return in equivalent time:
   - File: `src/auth/auth.service.ts`
   - Return 202 immediately in both branches; perform all work (DB write + email send) asynchronously
   - `setImmediate()` is NOT sufficient — the known-user path performs `randomBytes` + `sha256` + `magicLinks.insert()` synchronously, which is measurably slower than the unknown-email path
   - Alternative: queue both paths identically (always do a dummy DB write for unknown emails)

7. **Custom 429 response** — no disclosure of which limit hit; include `Retry-After`

8. **E2e tests**:
   - Exceed per-email limit → 429
   - Exceed per-IP limit → 429
   - Below limit → 200/202

---

## Phase 4: MCP Hardening

**Threat IDs:** THR-TB06-I-01 (SSRF), THR-TB03-I-01 (MCP credential disclosure)

**Depends on:** Phase 1 (tenant scoping in MCP repository)

**What changes:**

1. **URL validation in `CreateMcpServerDto`** (defense-in-depth only — does NOT prevent DNS rebinding):
   - File: `src/mcp/dto/create-mcp-server.dto.ts`
   - `@IsUrl({ protocols: ['https'], require_tld: true })`
   - Custom validator: resolve DNS, reject private/link-local/loopback/metadata IPs
   - This is a first-line filter; the SSRF-safe fetch wrapper (step 2) is the authoritative check at fetch time

2. **SSRF-safe fetch wrapper** (authoritative — re-resolves DNS on every call to prevent rebinding):
   - New file: `src/mcp/ssrf-safe-fetch.ts`
   - Resolves hostname → checks IP against blocklist (RFC 1918, 169.254.x.x, ::1, etc.) **at fetch time, not just registration**
   - Disables redirect following; sanitizes any 3xx response (never expose `Location` header contents to caller)
   - Caps response body at 1MB
   - Used by `McpService` for all outbound MCP calls

3. **Redact credentials from list/read responses**:
   - File: `src/mcp/mcp.controller.ts`
   - Strip `bearerToken`, `oauth2Config.clientSecret/accessToken/refreshToken` from response DTOs
   - Add `X-MCP-Untrusted: true` header on tool execution responses

4. **E2e tests**:
   - Register MCP with `http://169.254.169.254/...` → rejected
   - Register MCP with `http://localhost:8080` → rejected
   - Register MCP with `https://valid.example.com` → accepted
   - List MCP servers → no credential fields in response

---

## Phase 5: OAuth Callback Fail-Closed

**Threat IDs:** THR-TB04-S-01 (unverified JWT fallback), THR-TB04-I-01 (error reflection)

**What changes:**

1. **Remove unverified decode fallback** in `completeLink`:
   - File: `src/common/auth/domo-link/domo-link.service.ts` (lines ~154-184)
   - On JWKS verify failure: throw `BadGatewayException('access_token_unverified')` with correlation ID
   - Delete the `catch → decodeJwt` branch entirely

2. **Sanitize error in redirect**:
   - File: `src/common/auth/domo-link/domo-link.controller.ts` (callback error handler)
   - Map all errors to stable codes (`link_failed`, `token_unverified`, `state_invalid`)
   - Never put `err.message` in query string

3. **Sanitize `DomoExceptionFilter`**:
   - File: `src/common/filters/domo-exception.filter.ts`
   - Return generic message + correlation ID to client
   - Log full upstream error detail server-side only

4. **E2e test**:
   - Mock JWKS to fail → callback returns error redirect with stable code, not raw message

---

## Phase 6: KMS Envelope Encryption

**Threat ID:** THR-TB03-I-02 (plaintext refresh tokens)

**External prerequisites (must be completed before implementation):**

| Dependency | Owner | What's needed |
|------------|-------|---------------|
| KMS key (CMK) | Adam | Create a symmetric `AES_256` KMS key in the same region as EKS. Dedicated to huckleberry token encryption — not shared with RDS. Tag: `service=huckleberry`, `purpose=token-encryption`. |
| IAM policy | Adam | Grant the huckleberry EKS pod role `kms:GenerateDataKey` and `kms:Decrypt` on the new key ARN. |
| Config env var | Deployment manifest | Add `KMS_KEY_ARN` (or `KMS_KEY_ID`) to the EKS deployment env. |
| npm package | Dev | `pnpm add @aws-sdk/client-kms` (trivial — other `@aws-sdk/*` packages already installed). |

**How envelope encryption works:**
- **Encrypt:** `KMS.GenerateDataKey({ KeyId, KeySpec: 'AES_256' })` → returns `{ Plaintext: DEK, CiphertextBlob: wrappedDEK }`. Use DEK for `AES-256-GCM(refreshToken)`. Store `{ ciphertext, iv, wrappedDEK }` in DB. Zero the plaintext DEK after use.
- **Decrypt:** `KMS.Decrypt({ CiphertextBlob: wrappedDEK })` → returns plaintext DEK. AES-GCM-decrypt the refresh token.
- **Caching:** Cache unwrapped DEKs in-memory (keyed by wrappedDEK hash, 5-min TTL) to avoid per-request KMS round-trips.

**What changes:**

1. **Create encryption service**:
   - New file: `src/common/crypto/envelope-encryption.service.ts`
   - `encrypt(plaintext) → { ciphertext, iv, dekId }`
   - `decrypt(ciphertext, iv, dekId) → plaintext`
   - AES-256-GCM with per-row DEK wrapped by KMS
   - In-memory DEK cache (5-min TTL)
   - Local dev mode: file-based key (no KMS calls) gated on `NODE_ENV !== 'production'`

2. **Add config** to `configuration.ts`:
   - `kms.keyArn` from `KMS_KEY_ARN` env var
   - Required in production; absent in local dev triggers file-based key mode

3. **Add schema columns** to `domoOauthTokens`:
   - File: `src/common/db/schema.ts`
   - Add `refreshIv` (VARBINARY), `refreshDekId` (VARCHAR)
   - Drizzle migration

4. **Update token store** to encrypt/decrypt:
   - File: `src/common/db/repositories/mysql-domo-token.store.ts`
   - `upsert()`: encrypt before write
   - `get()`: decrypt after read
   - Fail hard if KMS unavailable (no plaintext fallback)

5. **Migration script** — encrypt existing plaintext tokens in-place

6. **Unit tests** — encrypt → decrypt round-trip; KMS failure → throws; DEK cache hit avoids second KMS call

7. **Accepted risk:** `domo_oauth_clients.registration_access_token` is also a stored credential (RFC 7592 — can manage/delete the OAuth client). Not encrypting it here because the CIMD migration will eliminate this table entirely. If CIMD is deferred, revisit.

---

## Phase 7: Web Hardening

**Threat IDs:** THR-TB01-D-02 (headers/CORS), THR-TB04-I-01 (error leak), THR-TB05-I-01 (log creds)

**External prerequisites:**

| Dependency | Owner | What's needed |
|------------|-------|---------------|
| SPA origin URL | Dev | Need the production SPA origin for CORS allowlist (e.g., `https://app.huckleberry.ai`). Add `CORS_ORIGIN` env var to deployment manifests. |
| No new AWS services | — | Pure code/config change. |

**What changes:**

1. **Install and configure `helmet`**:
   - File: `src/main.ts`
   - HSTS (1y, includeSubDomains), CSP (`frame-ancestors 'none'`), nosniff, referrer-policy

2. **Explicit CORS allowlist**:
   - File: `src/main.ts`
   - `app.enableCors({ origin: [SPA_ORIGIN], credentials: true })`

3. **Gate Swagger in production**:
   - File: `src/main.ts`
   - Only mount `/docs` when `NODE_ENV !== 'production'`

4. **Redact sensitive values in logging interceptor**:
   - File: `src/common/interceptors/logging.interceptor.ts`
   - Strip `token`, `authorization`, `cookie`, `x-csrf-token` from logged request data

5. **Redact magic-link URLs in console email**:
   - File: `src/auth/email.service.ts`
   - Log `"Magic link issued for <email> (token: <first-8-chars>...)"` instead of full URL

6. **Gate verbose logging**:
   - Require both `NODE_ENV === 'development'` AND `VERBOSE_LOGGING=true` (already partially there, verify)

---

## Phase 8: Housekeeping

**Threat IDs:** THR-TB02-E-01 (dev-token flag), THR-TB02-R-01 (audit logging), THR-TB04-E-02 (AgentIdGuard)

**External prerequisites:**

| Dependency | Owner | What's needed |
|------------|-------|---------------|
| CloudWatch log group (optional) | Infra | If structured audit events need a dedicated log group/stream separate from app logs. Not blocking — stdout audit JSON is picked up by existing log routing. |
| No new AWS services | — | Pure code change. |

**What changes:**

1. **Explicit dev-bypass flag**:
   - Files: `src/common/guards/session-auth.guard.ts` (by Phase 2 it's unified), `src/common/auth/domo-context.interceptor.ts`, `src/main.ts`
   - Require `ALLOW_DEV_BYPASS=true` in addition to `NODE_ENV !== 'production'`
   - Never read `DEV_TOKEN` when flag is absent; never set `NODE_TLS_REJECT_UNAUTHORIZED=0` without it

2. **Structured audit events**:
   - New file: `src/common/audit/audit.service.ts`
   - Emits JSON events: `{ actor, action, target, sourceIp, timestamp, outcome }`
   - Events: `auth.signin.success`, `auth.signin.failed`, `session.revoked`, `domo.linked`, `domo.unlinked`, `admin.user.provisioned`, `throttle.exceeded`
   - Writes to stdout as structured JSON (picked up by log aggregation)

3. **Wire or remove `AgentIdGuard`**:
   - File: `src/common/guards/agent-id.guard.ts`
   - Decision: wire it onto agent execute/resume routes in `agents.controller.ts`, or delete the dead code
   - Recommendation: wire it — validates agentId against the cached registry before forwarding to Domo

4. **E2e tests**:
   - `ALLOW_DEV_BYPASS` unset + `DEV_TOKEN` set + `NODE_ENV=development` → dev bypass does NOT activate
   - `ALLOW_DEV_BYPASS=true` + dev token → bypass works

---

## Dependency Graph

```
Phase 5 (fail-closed) ──► Phase 1 (tenant scoping) ──► Phase 4 (MCP hardening)
Phase 1 (tenant scoping) ──► Phase 8 (housekeeping modifies same file: domo-context.interceptor.ts)
Phase 2 (unified guard) ──► Phase 8 (dev-bypass uses unified guard)
Phase 2 requires frontend deploy coordination (cross-repo)
Phases 3, 6, 7 are independent of each other and of the above chain
```

Recommended execution order: 5 → 1 → 2 (with frontend) → 3 → 4 → 6 → 7 → 8
(3/6/7 can run in parallel after Phase 1 lands; Phase 5 is small and should ship first to prevent corrupted tenant bindings via the unverified JWT fallback)

---

## Implementation Risks

| Risk | Phase | Mitigation |
|------|-------|------------|
| All-at-once guard replacement touches 15+ files | 2 | Keep old guards as thin delegates during transition; delete in follow-up PR |
| In-memory throttler resets on pod restart (OOMKill, deploy) | 3 | Acceptable for single-pod. Document that email-bombing protection has a gap window on restart. Add Redis when scaling beyond one pod. |
| No Drizzle rollback strategy for new tables/columns | 1, 6 | Author down-migrations manually. For Phase 6: keep plaintext column populated until encryption verified across all rows. |
| 10MB `express.json()` body limit on auth routes enables request-flood DoS | 3 | Add per-route body size constraints: 1KB on `/auth/*`, 10KB on most routes, 1MB only where needed (MCP tool responses). |
| DEK cache grows unboundedly during bulk migration (Phase 6 step 5) | 6 | Add max cache size with LRU eviction (e.g., 1000 entries). |

---

## Lower Priority (document or defer)

These are real but lower-severity. Track as follow-ups rather than blockers:

- **CSP `script-src`** — Phase 7 only adds `frame-ancestors: none`. Without `script-src` restrictions, XSS can read the CSRF double-submit token. Add restrictive CSP once SPA deployment model (inline scripts? CDN?) is understood.
- **`SameSite=Strict`** — After Phase 2 CSRF lands and is validated, tighten from `Lax`. Low urgency given VPN-only access.
- **`secure` flag on cookie in non-production** — Currently gated on `NODE_ENV === 'production'`. Staging/QA environments with other NODE_ENV values send cookies over HTTP. Phase 8's `ALLOW_DEV_BYPASS` pattern should extend to this.
- **Agent cache global scope** — `AgentsService` cache is shared across tenants. Accepted risk: agents come from Domo (not user-owned), but should be explicitly documented as such in the threat model remediation status.
- **THR-TB04-T-01 (Cypher/query passthrough)** — Plan claims to cover all findings but this Medium-rated one has no phase. Either add a phase or mark as accepted risk with rationale.
- **THR-TB08-I-01 (default dev secrets in compose)** — Low-rated, no code change planned. Document as accepted risk.

---

## Documentation Updates (per phase)

Each phase MUST update the relevant documentation before the PR is considered complete:

| Phase | Docs to update |
|-------|----------------|
| 1 (tenant scoping) | `docs/authentication.md` (ALS context shape, repository scoping), DB schema docs (new tables), `docs/local-development.md` (local MySQL setup for personas/MCP) |
| 2 (unified guard) | `docs/authentication.md` (guard architecture, CSRF enforcement, SkipCsrf decorator usage) |
| 3 (rate limiting) | `docs/authentication.md` (rate limit thresholds), `docs/local-development.md` (throttler config env vars) |
| 4 (MCP hardening) | `docs/authentication.md` (MCP authz model), MCP API docs (URL requirements, redacted fields) |
| 5 (OAuth fail-closed) | `docs/authentication.md` (link flow error handling, removed fallback) |
| 6 (KMS encryption) | `docs/authentication.md` (token-at-rest encryption), `docs/local-development.md` (local dev key setup), `docs/security/` (encryption implementation notes) |
| 7 (web hardening) | `docs/local-development.md` (CORS origin config, Swagger access), security headers documentation |
| 8 (housekeeping) | `docs/local-development.md` (ALLOW_DEV_BYPASS flag, audit event format), `docs/security/` (audit trail schema) |

Additionally, after all phases complete:
- Update `docs/security/ThreatModel_huckleberry-server.md` with a remediation status table marking each finding as resolved + the PR/commit that addressed it
- Update any architecture diagrams that reference the old two-guard model or in-memory stores

---

## Verification

For each phase:
1. Run `pnpm lint` — must pass
2. Run existing e2e tests — no regressions in `auth-flow.e2e-spec.ts`, `gatekeeper-auth.e2e-spec.ts`, `agents.e2e-spec.ts`
3. Run new phase-specific e2e tests
4. Manual smoke test: start the app (`pnpm start:dev`), sign in, verify persona CRUD and MCP operations work for the authenticated user
5. Documentation reviewed and updated per the table above

Final validation:
- 15 of 17 threat model findings have a corresponding code change; 2 deferred with rationale
- Each negative-case test proves the vulnerability is closed
- No in-memory data stores remain for Category B resources
- All docs reflect the new architecture (no stale references to DomoAuthGuard, in-memory stores, or plaintext tokens)
