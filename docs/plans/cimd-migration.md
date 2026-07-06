# Plan: Migrate from DCR to CIMD for Domo OAuth Client Identity

**Status:** Draft
**Created:** 2025-07-01

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

**Per-deployment config:** The `client_id` and `redirect_uris` values are deployment-specific. Read them from env vars (reuse `DOMO_OAUTH_REDIRECT_URI` for the redirect, derive `client_id` from the same base URL).

### 2. Update `DomoOAuthClient` to use the URL as `client_id`

In `buildAuthorizeUrl()` and `exchangeCode()`, pass the metadata document URL as `client_id` instead of the stored DCR `client_id`.

```javascript
client_id = https://huckleberry-dev.domotech.io/.well-known/oauth-client

```

Gatekeeper detects the URL shape (`scheme=https`, non-empty path) and enters CIMD handling instead of client-store lookup.

### 3. Remove DCR code path

- Remove `registerClient()` from `DomoOAuthClient`
- Remove `ensureClientRegistered()` from `DomoLinkService`
- Remove `ClientCredentialStore` and its injection
- Drop the `domo_oauth_clients` table (new Drizzle migration)

### 4. Remove `resolveClientId()` lookup

Replace the per-issuer credential lookup with the static metadata URL:

```typescript
private getClientId(): string {
  // The CIMD client_id is the metadata document URL
  return `${this.baseUrl}/.well-known/oauth-client`;
}
```

### 5. Update `validateInstance()`

Currently `validateInstance()` probes RFC 8414 discovery. Add a check that the discovery response includes `client_id_metadata_document_supported: true` — if not, the target Gatekeeper doesn't support CIMD and we should fail fast with a clear error.

### 6. Handle the `private_key_jwt` option (optional, post-MVP)

CIMD supports confidential clients via `private_key_jwt`. For MVP, huckleberry remains a public PKCE client (`token_endpoint_auth_method: "none"`). If we ever need confidential client auth:

- Generate an ES256 key pair
- Add `jwks` (inline) or `jwks_uri` to the metadata document
- Sign a `client_assertion` JWT on each `/token` request

Not needed now — public PKCE is fine for the authorization-code + refresh flow.

## Migration Plan (zero-downtime)

1. **Add the metadata endpoint** — deploy it while DCR is still active. No behavior change.
2. **Get huckleberry added to `allowed-origins`** on the target Gatekeeper.
3. **Switch `client_id` in `buildAuthorizeUrl` / `exchangeCode`** to the URL. New link flows use CIMD; existing refresh tokens continue working (they're keyed by `link_id`, not `client_id`).
4. **Remove DCR code + drop `domo_oauth_clients` table** in a follow-up PR.

Steps 1–2 can ship independently. Step 3 is the behavioral cutover. Step 4 is cleanup.

## Env Var Changes

| Var                        | Current use                      | After CIMD                                                       |
| -------------------------- | -------------------------------- | ---------------------------------------------------------------- |
| `DOMO_OAUTH_REDIRECT_URI`  | Passed to DCR + authorize URL    | Still needed — goes into the metadata document and authorize URL |
| `DOMO_OAUTH_CLIENT_ID`     | Fallback for `resolveClientId()` | **Remove** — replaced by the metadata URL                        |
| `DOMO_OAUTH_CLIENT_SECRET` | Confidential client fallback     | **Remove** — public PKCE, no secret                              |
| `MAGIC_LINK_BASE_URL`      | Base URL for magic-link emails   | Also used to derive the metadata document URL                    |

## What This Eliminates

- `domo_oauth_clients` table and all its machinery
- `ClientCredentialStore` interface + MySQL implementation
- DCR registration logic (`registerClient()`)
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
3. **Existing refresh tokens:** Tokens minted under the old DCR `client_id` should continue to work — Gatekeeper tracks authorizations by `(customer, client_id)`. Verify that switching `client_id` format doesn't invalidate existing grants. If it does, users will need to re-link (one-time).
4. **Scopes:** If we include `scope` in the metadata document, Gatekeeper uses it verbatim. If we omit it, Gatekeeper assigns `default-scopes` (`ai:read ai:execute`). We need broader scopes (`identity:read`, `dataset:data:read`) — so we must include `scope` explicitly.
