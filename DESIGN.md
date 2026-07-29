# CIMD OAuth Client Migration — Design Document

> Migrating from DCR (Dynamic Client Registration, RFC 7591) to CIMD
> (Client ID Metadata Document, draft-ietf-oauth-client-id-metadata-document-00).

---

## 1. Purpose
**Decision:** Replace DCR with CIMD. Huckleberry hosts a metadata document at `/.well-known/oauth-client`; the document URL becomes the `client_id`. Gatekeeper fetches it on demand, so scope and redirect URI changes take effect immediately by updating one document — no per-instance Postman calls, no `domo_oauth_clients` table, no `registerClient()` flow. The DCR code path is removed entirely.
**Rationale:** DCR forces manual coordination across every Domo server whenever config changes. CIMD makes huckleberry the authority over its own client metadata, turning a multi-server operation into a single-file edit.

## 2. API Surface
**Decision:** Add `GET /.well-known/oauth-client` — public, no auth, served by a new `OAuthClientMetadataController`. The route is added to the `setGlobalPrefix('api', ...)` exclude list in `main.ts` (like `health`) so it is served at exactly `/.well-known/oauth-client` — CIMD requires the `client_id` URL to byte-match the fetch URL. The ALB ingress ALSO needs a chart change: with `frontend.enabled: true` (dev3), only `/api` and `/domo` route to the BFF — `/.well-known/oauth-client` must be added as a BFF path in the domo-helm ingress or Gatekeeper fetches the SPA's index.html. Returns the CIMD JSON document with `client_id` (derived from `MAGIC_LINK_BASE_URL`), `redirect_uris`, `scope`, `grant_types`, `response_types`, `token_endpoint_auth_method: "none"`. `DomoOAuthClient.resolveClientId()` is replaced by a synchronous `getClientId()` that returns the `DOMO_OAUTH_CLIENT_ID` override when set (dev-only escape hatch for local rigs, whose Gatekeeper can't fetch our document), otherwise the metadata URL. `registerClient()` and `ensureClientRegistered()` are deleted. No new env vars.
**Rationale:** `MAGIC_LINK_BASE_URL` is already the canonical public base URL for this deployment — reusing it avoids a new env var and keeps the metadata URL derivation deterministic. The rig override replaces the old `InMemoryClientCredentialStore` dev fallback with a plain config read.

## 3. Data Model
**Decision:** Drop the `domo_oauth_clients` table via a new Drizzle migration. Delete `ClientCredentialStore` interface, `InMemoryClientCredentialStore`, `MysqlClientCredentialStore`, and the `CLIENT_CREDENTIAL_STORE` injection token. Remove all injection sites in `DomoOAuthClient` and `DomoLinkModule`.
**Rationale:** CIMD is stateless — the `client_id` is derived from config at runtime. No registration record needs to be stored or looked up per issuer.

## 4. Auth & Access Control
**Decision:** `GET /.well-known/oauth-client` is decorated `@Public()` — no session required, Gatekeeper fetches it S2S. Response includes `Cache-Control: max-age=300` so scope/redirect changes propagate within 5 minutes. `validateInstance()` drops the DCR-era `registration_endpoint` requirement and instead requires `client_id_metadata_document_supported: true` in the discovery document — if absent, throw `BadRequestException` with a clear message. When the `DOMO_OAUTH_CLIENT_ID` rig override is set, the CIMD-support check is skipped (the rig resolves the client from its own store); the `issuer` presence check stays in both modes.
**Rationale:** The document contains no secrets. Fast cache invalidation (5 min vs Gatekeeper's default 1h) is important for the scope-change use case that motivated this migration. Fail-fast on unsupported Gatekeeper avoids a silently broken flow; requiring CIMD support in rig mode would incorrectly block a flow that never uses it.

## 5. Dependencies
**Decision:** No new packages. Runtime deps: `MAGIC_LINK_BASE_URL` (derives the `client_id` URL), `DOMO_OAUTH_REDIRECT_URI`, `DOMO_OAUTH_SCOPES`, and optional `DOMO_OAUTH_CLIENT_ID` (rig-only override, unset in deployed envs). `DOMO_OAUTH_CLIENT_SECRET` is removed entirely, along with the dead `clientCredentials()` method and the client-secret Basic-auth branch in `authHeaders()`. External gate: Gatekeeper `allowed-origins` Config Central entry for dev3 and prod — without it, Gatekeeper rejects the CIMD `client_id`. Implementation ships on the branch; allowlist is coordinated separately and can be applied quickly.
**Rationale:** Decoupling the code change from the infra gate means the branch is review-ready and testable the moment the allowlist lands.

## 6. Error Handling
**Decision:** Three failure modes handled explicitly: (1) Gatekeeper missing `client_id_metadata_document_supported` → `BadRequestException` in `validateInstance()` with a user-facing message (skipped in rig-override mode); (2) `MAGIC_LINK_BASE_URL` silently defaults to `http://localhost:5173`, so "not configured" never fires — instead throw at boot when `NODE_ENV=production` and the base URL is not HTTPS; (3) Gatekeeper can't reach our document → mitigated by `Cache-Control: max-age=300`, Gatekeeper handles its own fetch retries. No retry logic added on our side.
**Rationale:** Fail-fast on misconfiguration is preferable to silent degradation into a broken flow.

## 7. Testing Strategy
**Decision:** Unit tests on `DomoOAuthClient`: `getClientId()` returns the CIMD URL, and the `DOMO_OAUTH_CLIENT_ID` override verbatim when set; `buildAuthorizeUrl`, `exchangeCode`, `refresh`, `revoke` all pass the resolved `client_id`; `validateInstance()` throws when `client_id_metadata_document_supported` is absent and skips that check in override mode. Delete `client-credential.store.spec.ts`; rewrite the `registerClient`/`resolveClientId` suites in `domo-oauth.client.spec.ts`. Integration test: `GET /.well-known/oauth-client` returns valid JSON with correct fields, no auth required, served without the `/api` prefix. No live Gatekeeper e2e — requires the allowlist, tested after that lands.
**Rationale:** Follows existing Jest patterns. Live round-trip is a deployment concern, not a CI concern.

## 8. Observability
**Decision:** Log `CIMD client_id: <url>` at startup. Log presence/absence of `client_id_metadata_document_supported` in `validateInstance()`. Remove DCR log lines. No new metrics — existing Logger pattern throughout.
**Rationale:** The startup log makes the active `client_id` visible in deploy logs without adding observability infrastructure.

## 9. Deployment
**Decision:** Dev-state cutover across three repos: (1) domo-helm chart PR — ingress path for `/.well-known/oauth-client` → BFF, chart version bump; (2) one BFF PR — metadata endpoint + prefix exclusion, `client_id` switch, full DCR/dead-code removal, drop-table migration; (3) huckleberry-gitops — bump `chartVersion` + `image.tag`, reconcile `DOMO_OAUTH_SCOPES`, verify the `dev-huckleberry-1-admin` AWS secret has no `DOMO_OAUTH_CLIENT_ID`/`_SECRET` keys (ExternalSecret `dataFrom: extract` injects every key — a leftover would silently activate the rig override in dev3). The Gatekeeper `allowed-origins` entry is the only external gate and can proceed in parallel. Existing refresh tokens were minted under DCR client_ids and will fail `invalid_grant` after the switch — we are pre-production, so clear `linked_domo_instances` / `domo_oauth_tokens` at deploy and re-link rather than build back-compat.
**Rationale:** No production data means zero-downtime choreography and refresh-token migration would be effort spent on a constraint we don't have. The ingress path is load-bearing: without it the document URL serves HTML and every CIMD flow fails at Gatekeeper's fetch step.

## 10. Rollout Plan
**Decision:** Branch is mergeable once: (a) Gatekeeper `allowed-origins` is updated for the target environment, (b) `pnpm test` passes, (c) manual smoke test confirms new auth flow uses the CIMD URL as `client_id` and Gatekeeper issues tokens. Production follows identically — update `allowed-origins` on the prod Gatekeeper instance first, then deploy.
**Rationale:** The allowlist is the only blocker. Code is self-contained and the test branch covers the full implementation so review and merge can happen independently of the Gatekeeper config change.
