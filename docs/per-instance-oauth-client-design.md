# Per-Instance OAuth Client Credentials — Design Document

## 1. Purpose
**Decision:** Extend `DomoOAuthClient` from a single-credential model to a per-instance credential registry. Each Domo instance has its own Gatekeeper, requiring a dedicated OAuth client registration. The system:
- Registers huckleberry as an OAuth client on each new Domo instance via Gatekeeper's RFC 7591 DCR endpoint (`POST /oauth2/register`)
- Stores per-instance credentials (`client_id`, `client_secret` if confidential, `registration_access_token` for self-management)
- Resolves the correct credentials per `issuerUrl` at runtime (authorize, exchange, refresh, revoke)

**Consumers:** `DomoOAuthClient` (runtime), `InstanceProvisioner` (registration), ops/admin (rotation, debugging)

**Rationale:** The current single `DOMO_OAUTH_CLIENT_ID` env var only works in dev against one instance. Production multi-tenant requires per-instance credentials because each Gatekeeper is an independent authorization server with its own client registry.

## 2. API Surface
**Decision:** No new external API endpoints. DCR is an internal concern triggered inside `InstanceProvisioner.provision()` at signup time. The credential lookup is internal to `DomoOAuthClient`.

Changes to existing internals:
- `DomoOAuthClient.buildAuthorizeUrl()`, `exchangeCode()`, `refresh()`, `revoke()` resolve credentials per `issuerUrl` from a `ClientCredentialStore` instead of reading a single `this.clientId`.
- `InstanceProvisioner.provision()` gains a DCR step: `POST {issuerUrl}/oauth2/register` with `token_endpoint_auth_method: "none"` (public client, PKCE-only), `redirect_uris`, and `scope`. Stores the returned `client_id` + `registration_access_token`.
- The BFF remains a **public PKCE client** in prod — no `client_secret`. PKCE's `code_verifier` provides equivalent protection for server-side apps doing user-delegated flows; a secret adds no meaningful security when the attacker already needs server access to extract either credential.
- No admin endpoint for manual registration at MVP. DCR-at-provision-time is sufficient. If credentials go stale, re-provisioning or a future RFC 7592 self-management call handles it.

**Rationale:** Keeps the public surface unchanged. The complexity is internal plumbing — credential resolution is a DI-level concern, not an API concern. Public client avoids per-instance secret management overhead with no meaningful security tradeoff for user-delegated flows.

## 3. Data Model
**Decision:** New `domo_oauth_clients` table keyed by `issuerUrl`:

```
domo_oauth_clients
  issuerUrl: VARCHAR(255) PK          -- matches Gatekeeper's `iss` claim (migrate to global UUID when platform provides one)
  clientId: VARCHAR(200)              -- returned by DCR
  registrationAccessToken: VARCHAR(2000)  -- for RFC 7592 self-management
  redirectUri: VARCHAR(500)           -- registered redirect URI
  scope: VARCHAR(1000)                -- registered scope set
  registeredAt: DATETIME
  lastUsedAt: DATETIME nullable
```

Key decisions:
- **Keyed on `issuerUrl`** for now — natural lookup key, one client per instance. Will migrate to a platform-provided global UUID when available.
- **No `client_secret` column** — public client, PKCE-only.
- **`registrationAccessToken` stored plaintext** — Aurora's KMS-encrypted storage handles at-rest protection. No application-level envelope encryption needed.
- **Relationship to `linkedDomoInstances`** — many links (per-user) → one client (per-instance). Joined by `issuerUrl`, no FK. Will tighten when global UUID lands.
- **Dev fallback** — `ClientCredentialStore` returns the env-var-based `DOMO_OAUTH_CLIENT_ID` when `issuerUrl` matches the configured dev instance. No real DCR call needed for local dev/test.
- **User status enum expanded:**
  ```
  'pending_provision' → 'pending_link' → 'active' | 'suspended'
  ```
  - `pending_provision` — user chose "I don't have Domo" at signup; we owe them an instance
  - `pending_link` — instance URL known (provisioned or provided at signup), awaiting PKCE connection. Bootstrap link row always exists with `issuerUrl`.
  - `active` — PKCE complete, linked
  - SPA routes on `status` alone — "Connect to Domo" page is always a single Connect button (URL is pre-filled from bootstrap link row)
- **Signup collects path + instance URL upfront:**
  - "I don't have Domo" → status = `pending_provision`, triggers provisioning
  - "Existing Domo User" + instance URL → status = `pending_link`, bootstrap link row created with user-provided URL
  - Both paths produce a bootstrap link row with `issuerUrl` before the user ever sees "Connect"

**Rationale:** Minimal new surface. The client row is a shared-per-instance concern distinct from per-user link rows. Keeping it separate avoids denormalizing credentials across every user's link row. Plaintext + Aurora encryption matches the existing refresh token strategy and avoids premature app-level KMS complexity.

## 4. Auth & Access Control
**Decision:**
- **DCR call at provision time:** No auth required — Gatekeeper's DCR is open-mode (rate-limited 10/hour/IP, 50 clients/tenant quota). The BFF POSTs directly to `POST {issuerUrl}/oauth2/register`.
- **Open-mode DCR is sufficient** because huckleberry spins up the instances it registers on — we control the Gatekeeper config. Rate limits + tenant quota handle abuse.
- **Runtime credential lookup:** Internal only — `DomoOAuthClient` resolves from the `ClientCredentialStore`. Never exposed to users or the SPA.
- **RFC 7592 self-management:** The `registrationAccessToken` is the bearer credential for future client metadata updates. Only the BFF holds it.
- **Provisioning trigger:** Only reachable via the signup flow (requires a valid magic-link email). No unauthenticated path can trigger DCR.

**Rationale:** Since huckleberry provisions the instances, it controls whether IAT mode is on. Open-mode DCR avoids the chicken-and-egg of needing authenticated Domo user credentials to mint an IAT before the OAuth client even exists. If huckleberry ever registers on instances it doesn't control, revisit with admin-path registration or bootstrap token from the provisioning API.

### Provisioning Questions (to resolve later)
1. **IAT mode on third-party instances** — if huckleberry ever needs to register on instances it doesn't spin up, how does it authenticate for DCR? Options: (a) provisioning API returns bootstrap token, (b) admin-path `POST /oauth2/admin/clients`, (c) keep open-mode. Current answer: (c) for self-provisioned instances.

## 5. Dependencies
**Decision:**
- **Gatekeeper DCR endpoint** (`POST {issuerUrl}/oauth2/register`) — only new external dependency. Simple JSON POST, same pattern as existing token exchange in `DomoOAuthClient`.
- **No new libraries** — plain `fetch` call.
- **Database** — new `ClientCredentialStore` interface with dual-mode implementations (`InMemoryClientCredentialStore` + `MysqlClientCredentialStore`), same pattern as `LinkRepository` and `DomoTokenStore`.
- **Failure mode:** If Gatekeeper is unreachable during DCR at signup, signup fails hard. User retries later. No async retry, no deferred registration.

**Rationale:** No new moving parts. DCR is a single HTTP call on an already-depended-on service. Failing hard keeps the signup path honest and avoids partial states (user exists but can't authenticate). If Gatekeeper is down, the instance is unusable anyway.

## 6. Error Handling
**Decision:**
- **DCR fails at signup** → `ServiceUnavailableException` (503). Signup service already wraps provisioner failures.
- **DCR returns unexpected response** (missing `client_id`, malformed JSON) → `BadGatewayException` (502). Same pattern as existing `postTokenWithHeaders()`.
- **Credential lookup miss at runtime** (no client for the `issuerUrl`) → `UnauthorizedException` with "re-link required" signal to the SPA. Shouldn't happen if provisioning succeeded.
- **Gatekeeper rate-limits DCR** (429) → propagate as 503 to signup caller. Log rate-limit headers.
- **No retries at MVP** — fail fast, user retries. Safe because DCR is a fresh POST each time.

**Rationale:** Consistent with existing error patterns in `DomoOAuthClient`. Hard failures surface clearly to both the user (retry) and ops (logs). No partial states to clean up.

### Provisioning Questions (continued)
2. **DCR idempotency** — does Gatekeeper deduplicate DCR calls (same `redirect_uri` + `scope` → same client), or does each POST create a new `client_id`? If no dedup, a retry after a network timeout could orphan a registered client. Need to confirm behavior and decide if cleanup is needed.

## 7. Testing Strategy
**Decision:**
- **Unit tests** for `ClientCredentialStore` (in-memory impl) — CRUD, dev-fallback behavior, miss returns null.
- **Unit tests** for DCR call in provisioner — mock `fetch`, verify request shape (`token_endpoint_auth_method: "none"`, correct `redirect_uris`, `scope`), verify response parsing, verify error paths (502, 429, malformed).
- **Unit tests** for `DomoOAuthClient` credential resolution — picks correct `client_id` per `issuerUrl`, throws on miss.
- **Integration test** — full signup flow with mocked Gatekeeper verifying: signup → DCR called → client stored → `link/start` uses stored `client_id` in authorize URL.
- **Coverage bar:** 80% on new code. No MySQL-specific tests at MVP — follows existing patterns already covered by e2e suite.

**Rationale:** The new code is mostly plumbing (store + fetch + resolution). Unit tests cover the logic; one integration test proves the wiring. 80% bar catches regressions without over-investing in a system that may evolve as provisioning questions get answered.

## 8. Observability
**Decision:** No additional observability beyond standard NestJS `Logger` pattern.
- DCR success: `log` — `DCR registered client ${clientId} on ${issuerUrl}`
- DCR failure: `warn` — status code, response body snippet
- Credential lookup miss at runtime: `warn` — signals data inconsistency
- Credential resolved on hot path: no log (too noisy)
- Structured fields include `issuerUrl` and `clientId` (never `registrationAccessToken`)

**Rationale:** DCR failures surface as 503s on the signup endpoint — caught by existing uptime monitoring. No new metrics or alerting needed at MVP.

## 9. Deployment
**Decision:** Standard deploy — commit to main, CI builds image, gitops bumps the image tag.
- **Database migration** — one Drizzle migration adding `domo_oauth_clients` table. Runs automatically on deploy.
- **Fewer env vars in prod** — prod reads client credentials from the DB store (populated by DCR at provision time). The current `DOMO_OAUTH_CLIENT_ID` / `DOMO_OAUTH_CLIENT_SECRET` / `DOMO_OAUTH_SCOPES` env vars become dev-only fallbacks, not required in prod.
- **Backwards compatible** — existing dev setups keep working via the env-var fallback in `ClientCredentialStore`. Empty table is fine in dev mode.
- **No infra changes** — no new services, no new secrets in Secrets Manager.

**Rationale:** Moving credentials from env vars to the DB actually simplifies prod config — one less thing to manage per deployment. DCR populates the store at runtime; ops doesn't need to manually configure per-instance secrets.

## 10. Rollout Plan
**Decision:** No existing users — product is unreleased. No backwards-compatibility concerns.

**Phase 1 — Full local circle:**
- Add `domo_oauth_clients` schema + migration
- Implement `ClientCredentialStore` interface + in-memory + MySQL impls
- Refactor `DomoOAuthClient` to resolve credentials from the store (env-var fallback for dev)
- Extend `InstanceProvisioner` (prod impl) to call DCR and persist the client
- Frontend: "Connect to Domo" flow on the signup page — user enters/selects instance, triggers `POST /api/auth/domo/link/start`, handles redirect + callback
- **Test full circle locally:** signup → DCR (against local Gatekeeper or dev instance) → client stored → "Connect to Domo" → PKCE flow → linked → workspace

**Phase 2 — Deploy:**
- Standard deploy. Prod reads from DB store, no per-instance env vars needed.
- Dev stub still bypasses DCR for `pnpm start:dev` without a real Gatekeeper.

**Kill switch:** Env-var fallback still works if DCR breaks — set `DOMO_OAUTH_CLIENT_ID` and the store returns it for the configured dev instance. No feature flag needed.

**Rationale:** Unreleased product means no migration path needed. Ship it right the first time. Full local testing catches integration issues before they hit prod.

### Provisioning Questions (continued)
3. **Frontend "Connect to Domo" UX** — what's the entry point? Signup page button? Post-magic-link landing page? Does the user provide their instance URL or is it auto-filled from provisioning?
