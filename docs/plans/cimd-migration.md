# Plan: Migrate from DCR to CIMD for Domo OAuth Client Identity

**Status:** Reviewed — ready to implement
**Created:** 2025-07-01
**Updated:** 2026-07-29 (gap review: routing, rig escape hatch, dead-code removal, dev-state cutover)

## Problem

Huckleberry currently registers as a Domo OAuth client via DCR (Dynamic Client Registration, RFC 7591). This creates per-instance client registrations stored in our `domo_oauth_clients` table. When config changes (e.g., redirect URI), the stale DCR registration must be manually cleared from both our DB and Gatekeeper — otherwise the old `redirect_uris` are baked in and the PKCE flow breaks.

## Proposed Solution

Switch to CIMD (Client ID Metadata Document, `draft-ietf-oauth-client-id-metadata-document-00`). With CIMD:

- The `client_id` is an HTTPS URL hosted by huckleberry (e.g., `https://huckleberry-dev.domotech.io/.well-known/oauth-client`)
- Gatekeeper fetches client metadata from that URL on demand (pull model vs DCR's push model)
- Config changes (redirect URI, scopes) take effect immediately — just update the hosted document
- No registration step, no orphaned clients, no `domo_oauth_clients` table needed

## Prerequisites

1. **Gatekeeper allowlist:** `https://huckleberry-dev.domotech.io` (dev3) and `https://huckleberry.ai` (prod) must be added to `oauth.server.cimd.allowed-origins` on their respective Gatekeeper instances. This is a Config Central change — coordinate with the Gatekeeper team.

2. **Gatekeeper version:** The target Gatekeeper instance must advertise `client_id_metadata_document_supported: true` in its RFC 8414 discovery response. Verify with:

   ```shell
   GET https://dev3.domo.com/.well-known/oauth-authorization-server
   ```

## Implementation Steps

### 1. Host the metadata document

Serve a static JSON response at `GET /.well-known/oauth-client` from the BFF. This is a public endpoint (no auth required — Gatekeeper fetches it server-to-server).

**Document shape:**

```json
{
  "client_id": "https://huckleberry-dev.domotech.io/.well-known/oauth-client",
  "client_name": "huckleberry",
  "redirect_uris": [
    "https://huckleberry-dev.domotech.io/api/auth/domo/callback"
  ],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "scope": "ai:execute ai:read ai:write content:data:read content:meta:read dataset:data:read dataset:meta:read identity:read identity:write search:read"
}
```

Key rules:

- `client_id` field MUST exactly match the URL used to fetch the document
- `redirect_uris` must include the actual callback URL for this deployment
- No `client_secret` or symmetric auth methods allowed
- `scope` is optional — if omitted, Gatekeeper assigns `oauth.server.cimd.default-scopes` (default `ai:read ai:execute`)

**Per-deployment config:** The `client_id` and `redirect_uris` values are deployment-specific. Read them from env vars (reuse `DOMO_OAUTH_REDIRECT_URI` for the redirect, derive `client_id` from `MAGIC_LINK_BASE_URL`).

**Routing — global prefix exclusion (required):** The BFF serves all routes under the `api` global prefix (`src/main.ts` — `setGlobalPrefix('api', { exclude: [...] })`). Without an exclusion, the controller would be served at `/api/.well-known/oauth-client`, violating the CIMD rule that the `client_id` URL byte-match the fetch URL. Add `.well-known/oauth-client` to the exclude list alongside `health`.

**Routing — ingress change (required):** With `frontend.enabled: true` (dev3's actual config, chart 0.4.6), the ALB ingress routes `/api` and `/domo` to the BFF and everything else — including `/.well-known/oauth-client` — to the frontend nginx, which would serve the SPA instead of the document. The domo-helm chart needs a `/.well-known/oauth-client` path routed to the BFF service. See step 9 (infra changes).

**Boot guard:** `MAGIC_LINK_BASE_URL` silently defaults to `http://localhost:5173` in `configuration.ts`, so a "not configured" check never fires. Instead, throw at boot when `NODE_ENV=production` and the base URL is not HTTPS — a localhost-derived `client_id` in prod is silently broken. (Validated 2026-07-29: dev3 gitops sets `MAGIC_LINK_BASE_URL: https://huckleberry-dev.domotech.io`, matching the ingress host.)

### 2. Update `DomoOAuthClient` to use the URL as `client_id`

All four `resolveClientId()` call sites — `buildAuthorizeUrl()`, `exchangeCode()`, `refresh()`, and `revoke()` — switch to the metadata document URL as `client_id`.

```javascript
client_id = https://huckleberry-dev.domotech.io/.well-known/oauth-client

```

Gatekeeper detects the URL shape (`scheme=https`, non-empty path) and enters CIMD handling instead of client-store lookup.

### 3. Remove DCR-era and dead code (complete list)

All of it goes in this PR — no DCR remnants left behind:

- `registerClient()` and the `DcrResponse` interface (`domo-oauth.client.ts`)
- `ensureClientRegistered()` from `DomoLinkService`, plus its `CLIENT_CREDENTIAL_STORE` injection
- `ClientCredentialStore` interface, `InMemoryClientCredentialStore`, `MysqlClientCredentialStore`, and the `CLIENT_CREDENTIAL_STORE` token + provider wiring in `DomoLinkModule`
- `clientCredentials()` on `DomoOAuthClient` — dead code, zero callers in `src/`
- `authHeaders()` Basic-auth branch and the `clientSecret` field — public PKCE client, no secret ever
- `AppConfig.domoOAuthClientSecret` and `DOMO_OAUTH_CLIENT_SECRET` handling in `configuration.ts`
- `resolveClientId()` (replaced by `getClientId()`, step 4)
- Spec cleanup: delete `client-credential.store.spec.ts`; rewrite the `registerClient` / `resolveClientId` suites in `domo-oauth.client.spec.ts` for the CIMD paths
- `domoOauthClients` table in `schema.ts` + a new Drizzle migration dropping `domo_oauth_clients`

### 4. Replace `resolveClientId()` with `getClientId()` (with rig escape hatch)

Replace the per-issuer credential lookup with the static metadata URL, keeping `DOMO_OAUTH_CLIENT_ID` as a dev-only override for local Domo instances (rigs):

```typescript
private getClientId(): string {
  // Dev-only escape hatch for local rigs: a rig's Gatekeeper can't fetch
  // our metadata document (localhost, no HTTPS, not on its allowlist), so
  // a manually-registered client_id can be supplied directly.
  if (this.clientIdOverride) return this.clientIdOverride;
  // The CIMD client_id is the metadata document URL
  return `${this.baseUrl}/.well-known/oauth-client`;
}
```

The override is global-when-set (applies to every issuer), read from `DOMO_OAUTH_CLIENT_ID` at construction. It replaces the old `InMemoryClientCredentialStore` dev fallback — no store needed, just a config read.

### 5. Update `validateInstance()`

Currently `validateInstance()` probes RFC 8414 discovery and **requires `registration_endpoint`** — a DCR-era check that must be removed. Replace it:

- When no `DOMO_OAUTH_CLIENT_ID` override is set (normal CIMD mode): require `client_id_metadata_document_supported: true` in the discovery response — if absent, the target Gatekeeper doesn't support CIMD; fail fast with a clear error.
- When the override is set (rig mode): skip the CIMD-support check — the rig resolves the client from its own client store, so CIMD support is irrelevant.
- Keep the existing `issuer` presence check.

### 6. Handle the `private_key_jwt` option (optional, post-MVP)

CIMD supports confidential clients via `private_key_jwt`. For MVP, huckleberry remains a public PKCE client (`token_endpoint_auth_method: "none"`). If we ever need confidential client auth:

- Generate an ES256 key pair
- Add `jwks` (inline) or `jwks_uri` to the metadata document
- Sign a `client_assertion` JWT on each `/token` request

Not needed now — public PKCE is fine for the authorization-code + refresh flow.

### 7. Local dev against rigs

Local development runs against a local Domo instance (rig) whose Gatekeeper cannot fetch our metadata document (localhost base URL, no HTTPS, not on the rig's `allowed-origins`). The escape hatch:

1. Register a public PKCE client on the rig manually (Postman DCR, as today).
2. Set `DOMO_OAUTH_CLIENT_ID` to that client_id in `.env`.
3. `getClientId()` returns the override verbatim; `validateInstance()` skips the CIMD-support check.

When `DOMO_OAUTH_CLIENT_ID` is unset (all deployed environments), pure CIMD applies.

### 8. Doc updates (same PR)

These describe DCR and go stale the moment this merges:

- `docs/authentication.md` — Layer B table list and the `domo-link/` file tree (`registerClient`, `client-credential.store.ts` entries)
- `docs/diagrams/auth-architecture.md` — remove `domo_oauth_clients` / `ClientCredentialStore` nodes and table rows
- `docs/local-development.md` — rewrite the `DOMO_OAUTH_CLIENT_ID` row as the rig-only override; drop the "register once via Postman" framing for deployed envs
- `docs/plans/security-hardening.md` (accepted-risk item 7) — the `registration_access_token` risk is resolved once the table drops; mark it closed
- `.env.example` and local `.env` — keep `DOMO_OAUTH_CLIENT_ID` (documented as rig-only override), remove any `DOMO_OAUTH_CLIENT_SECRET` references

### 9. Infra: domo-helm chart + huckleberry-gitops

**domo-helm (`~/dev/domo-helm/charts/huckleberry`):**

1. `templates/ingress.yaml` — in the `frontend.enabled` branch, add a path routing `/.well-known/oauth-client` to the BFF service (alongside `/api` and `/domo`, before the catch-all `/` → frontend). Without this, Gatekeeper fetches the SPA's index.html instead of the metadata document.
2. Bump `version` in `Chart.yaml` (Jenkins requires it), `helm lint` + `helm template`, PR, merge → Jenkins publishes to ECR OCI.
3. Note: the local checkout may be stale — the frontend toggle only exists upstream (chart ≥ 0.4.3). Pull before editing.

**huckleberry-gitops (`~/dev/huckleberry-gitops/instances/dev-ai/dev3`):**

1. `config.yaml` — bump `chartVersion` to the new chart release.
2. `values.yaml` — reconcile `DOMO_OAUTH_SCOPES` (currently has `identity:write` but not `content:meta:write`; local `.env.example` has the reverse — pick the intended set). `MAGIC_LINK_BASE_URL` and `DOMO_OAUTH_REDIRECT_URI` are already correct; no `DOMO_OAUTH_CLIENT_ID`/`_SECRET` present in values — keep it that way.
3. Bump the BFF `image.tag` to the build containing the CIMD changes (normal deploy flow).

**AWS secret check (`dev-huckleberry-1-admin`):** The chart's ExternalSecret uses `dataFrom: extract`, which injects **every** key in the secret as an env var. Verify the secret does not contain `DOMO_OAUTH_CLIENT_ID` or `DOMO_OAUTH_CLIENT_SECRET` — a leftover `DOMO_OAUTH_CLIENT_ID` key would silently activate the rig override in dev3 and bypass CIMD entirely. Remove them if present.

**Post-deploy validation:** `curl https://huckleberry-dev.domotech.io/.well-known/oauth-client` returns the JSON document with the matching `client_id`, and the startup log shows the CIMD URL (not an override).

## Migration Plan (dev-state cutover)

We are pre-production with no data to preserve — no zero-downtime choreography or refresh-token back-compat needed.

1. **Get huckleberry added to `allowed-origins`** on the dev3 Gatekeeper (external gate — can proceed in parallel with implementation).
2. **Ship the chart PR** (domo-helm): ingress path for `/.well-known/oauth-client` → BFF; Jenkins publishes the new chart version.
3. **Ship one BFF PR**: metadata endpoint + prefix exclusion, `client_id` cutover, full DCR/dead-code removal, drop-table migration.
4. **Gitops deploy** (huckleberry-gitops dev3): bump `chartVersion` + BFF `image.tag`, reconcile `DOMO_OAUTH_SCOPES`, confirm the AWS secret carries no `DOMO_OAUTH_CLIENT_ID`/`_SECRET` keys (see step 9).
5. **Clear the dev databases at deploy** — existing refresh tokens were minted under DCR client_ids and will fail `invalid_grant` under the new `client_id`; wiping `linked_domo_instances` / `domo_oauth_tokens` (the drop migration handles `domo_oauth_clients`) and re-linking is the clean path.

## Env Var Changes

| Var                        | Current use                      | After CIMD                                                                  |
| -------------------------- | -------------------------------- | --------------------------------------------------------------------------- |
| `DOMO_OAUTH_REDIRECT_URI`  | Passed to DCR + authorize URL    | Still needed — goes into the metadata document and authorize URL            |
| `DOMO_OAUTH_CLIENT_ID`     | Fallback for `resolveClientId()` | **Keep as dev-only rig override** — unset in all deployed envs (pure CIMD)  |
| `DOMO_OAUTH_CLIENT_SECRET` | Confidential client fallback     | **Remove** — public PKCE, no secret                                          |
| `MAGIC_LINK_BASE_URL`      | Base URL for magic-link emails   | Also derives the metadata document URL; boot guard rejects non-HTTPS in prod |

## What This Eliminates

- `domo_oauth_clients` table and all its machinery
- `ClientCredentialStore` interface + in-memory and MySQL implementations
- DCR registration logic (`registerClient()`, `ensureClientRegistered()`, `DcrResponse`)
- Dead code: `clientCredentials()` (zero callers), client-secret Basic auth in `authHeaders()`
- The "stale registration" failure mode (redirect URI mismatch after config change)
- Orphaned client registrations at Gatekeeper

## Session Resilience (parallel improvement)

Separate from CIMD but related to auth stability. Currently, session cookie JWTs are signed with `SESSION_SIGNING_KEY`. If the key rotates on deploy, all active sessions are immediately invalid (hard logoff for every user).

### Goals

- No hard logoff on routine deploys
- Graceful session expiry with user-visible TTL
- Key rotation without mass invalidation

### Approach

1. **Dual-key verification**: Accept signatures from both the current and previous signing key during a configurable grace window. On verify, try current key first, fall back to previous. New sessions always sign with the current key.
2. **Proactive refresh on the frontend**: When `/auth/me` returns a session nearing expiry (e.g. <1h remaining on the sliding 12h TTL), the frontend should silently re-issue via a refresh endpoint rather than waiting for a hard 401.
3. **Stable key from Secrets Manager**: The signing key should be a stable secret that only rotates intentionally, not on every deploy. Document the rotation procedure (update secret, deploy with both keys in grace period, remove old key after TTL expires).

### Not doing (MVP)

- Redis session store (solves multi-replica, not key rotation)
- Opaque tokens (removes JWT verification advantage for the guard)

---

## Risks / Open Questions

1. **Gatekeeper caching:** Metadata documents are cached up to 1 hour. If we deploy a redirect URI change, there's up to a 1h window where Gatekeeper might serve the old metadata from cache. Mitigation: set short `Cache-Control: max-age=300` on the metadata endpoint.
2. **Allowlist coordination:** Requires Gatekeeper team to add our origin. This is an external dependency.
3. ~~**Existing refresh tokens:**~~ Resolved — dev state, no data to preserve. Refresh tokens minted under DCR client_ids **will** fail (`invalid_grant`) after the cutover; we clear the dev databases and re-link (see Migration Plan).
4. **Scopes:** The document must include `scope` explicitly (omitting it falls back to Gatekeeper's `default-scopes` of `ai:read ai:execute` — too narrow for us). The document is built from `DOMO_OAUTH_SCOPES`, so each deployment controls its own set. Known divergence to reconcile: dev3 gitops grants `identity:write` but not `content:meta:write`; local `.env.example` has `content:meta:write` but not `identity:write`. Also note: scope changes propagate immediately only for *new* authorizations — already-issued refresh tokens keep their originally granted scopes.
