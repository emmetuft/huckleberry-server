# Huckleberry Server

NestJS Backend-for-Frontend (BFF) that proxies Domo Agent APIs and provides named-agent endpoints for the Huckleberry AI assistant.

## Prerequisites

- Node.js 20+
- pnpm 8+ (`npm install -g pnpm` if you don't have it)
- A Domo developer token with AI Services access

### Required Domo Feature Flags

The following features must be enabled on the Domo instance (via `tug-eks`) for the Agent APIs to work:

```bash
tug-eks set feature -f ai-services -s true
tug-eks set feature -f ai-services-assistants -s true
tug-eks set feature -f ai-services-conversational-agent -s true
tug-eks set feature -f ai-services-domo-gpt -s true
tug-eks set feature -f ai-assistant-tool-calling -s true
```

Without these, the agent search/execute endpoints will return `403 Forbidden` with error code `DS-0049` ("Required AI Services features are not all enabled").

## Setup

```bash
pnpm install
cp .env.example .env
# Edit .env with your Domo instance URL and developer token
```

> This project uses **pnpm** exclusively. `pnpm-lock.yaml` is the source of truth; `package-lock.json` and `yarn.lock` are gitignored.

### Environment Variables

| Variable                 | Required      | Default                 | Description                                                                                                                        |
| ------------------------ | ------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `DOMO_INSTANCE_URL`      | Yes           | —                       | Domo instance base URL (e.g. `https://your-instance.domo.com`). Used as the downstream API host and the default Gatekeeper issuer. |
| `DEV_TOKEN`              | Yes (dev)     | —                       | Domo developer token. Satisfies the legacy `DomoAuthGuard` on Category A routes until Layer B (Domo OAuth linkage) lands.          |
| `NODE_ENV`               | No            | `development`           | `development` or `production`                                                                                                      |
| `PORT`                   | No            | `3000`                  | HTTP listen port                                                                                                                   |
| `VERBOSE_LOGGING`        | No            | `false`                 | Log request/response bodies for outbound Domo calls and inbound requests                                                           |
| `HUCKLEBERRY_AGENT_ID`   | Yes           | —                       | Domo agent GUID for the Huckleberry embedded agent (differs per environment)                                                       |
| `SESSION_SIGNING_KEY`    | Yes (Layer A) | —                       | HS256 secret for the `hb_session` cookie. Generate with `openssl rand -hex 32`.                                                    |
| `ADMIN_API_KEY`          | Yes (Layer A) | —                       | Header value required on `POST /api/admin/users` to seed operators / pilot users. Generate with `openssl rand -hex 32`.            |
| `MAGIC_LINK_BASE_URL`    | No            | `http://localhost:5173` | SPA host the magic-link emails link to. The path `/auth/signin?token=...` is appended automatically.                               |
| `MAGIC_LINK_TTL_SECONDS` | No            | `900`                   | Magic-link expiry (15 min default).                                                                                                |
| `SESSION_TTL_SECONDS`    | No            | `43200`                 | Huckleberry session sliding TTL (12 h default).                                                                                    |
| `AUTH_PROVIDER`          | No            | `dev`                   | `dev` keeps the legacy `DomoAuthGuard` on Category A routes; `gatekeeper` (Sprint 4+) flips to multi-tenant JWT verification.      |
| `GATEKEEPER_ISSUERS`     | No            | —                       | CSV of allowed `iss` values (multi-tenant). Falls back to `DOMO_INSTANCE_URL` if unset.                                            |
| `GATEKEEPER_JWKS_URIS`   | No            | —                       | CSV of `iss=uri` overrides when JWKS lives at a different host/scheme than the issuer.                                             |
| `GATEKEEPER_AUDIENCE`    | No            | —                       | Optional `aud` claim to enforce on inbound JWTs.                                                                                   |
| `GATEKEEPER_TEST_TOKEN`  | No            | —                       | Real Gatekeeper-issued access token for the live integration spec (`test/gatekeeper-auth.e2e-spec.ts`). Auto-skips when unset.     |

## Running

```bash
# Development (watch mode)
pnpm start:dev

# Development with verbose request logging
VERBOSE_LOGGING=true pnpm start:dev

# Production
pnpm build
pnpm start:prod
```

## Authentication — Layer A (magic-link sign-in)

Huckleberry is a standalone SaaS. The huckleberry frontend (`~/dev/huckleberry`) signs users in via a magic-link emailed by this BFF. There is no self-service signup — operators seed users with `POST /api/admin/users`.

| Endpoint                         | Auth                     | Purpose                                                                                                       |
| -------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/signin/request`  | public                   | Send a magic-link email. Returns 202 regardless of whether the email exists (no account-existence leak).      |
| `GET /api/auth/signin?token=...` | public                   | Consume a magic-link token. Sets `hb_session` (HttpOnly) + `csrf_token` cookies on success.                   |
| `POST /api/auth/logout`          | session + CSRF           | Revokes the session.                                                                                          |
| `GET /api/auth/me`               | session                  | Returns the current huckleberry user (or 401).                                                                |
| `POST /api/admin/users`          | `x-admin-api-key` header | Operator endpoint to seed a user + send their first magic link. Dev-mode response includes the generated URL. |

Stores are in-memory today (lost on BFF restart). Swap-to-Aurora is a follow-up — see `docs/authentication.md` for the design.

Design rationale, schema, multi-tenant story: **`docs/authentication.md`** and `docs/diagrams/oauth-flow.md`.

## Testing

```bash
pnpm test               # unit tests (44 — auth, JWKS, guards, services)
pnpm test:auth          # in-process Layer A e2e (magic-link → session → CSRF → logout → revocation), ~1s
pnpm test:e2e           # all end-to-end tests including the live Gatekeeper spec (auto-skips without GATEKEEPER_TEST_TOKEN)
pnpm test:cov           # coverage report
pnpm demo:auth          # live demo of the sign-in flow via curl against a running BFF (no browser, no SPA)
```

`pnpm test:auth` is the canonical "did Layer A regress?" check — boots the BFF in-memory, overrides the email service with one that captures the URL, walks the full chain in <1 second.

## End-to-end sign-in (BFF + SPA + browser, freemium auto-provisioning)

This is the path you'd demo to a colleague. Self-service signup: user enters email → BFF provisions a Domo instance (stub returns the dev instance in local dev) → user gets a magic-link → clicks it → lands in the app linked and active.

**One-time setup**

In `.env`:

```
# Layer A
SESSION_SIGNING_KEY=<openssl rand -hex 32>
ADMIN_API_KEY=<openssl rand -hex 32>
MAGIC_LINK_BASE_URL=http://localhost:5173

# Gatekeeper (multi-tenant verifier — used internally on token responses)
GATEKEEPER_ISSUERS=http://domo-labs-dev.dev.domo.com:443
GATEKEEPER_JWKS_URIS=http://domo-labs-dev.dev.domo.com:443=https://domo-labs-dev.dev.domo.com/oauth2/jwks
GATEKEEPER_TRANSPORT_URIS=http://domo-labs-dev.dev.domo.com:443=https://domo-labs-dev.dev.domo.com

# Stubbed instance-provisioner credentials. In dev, signups "provision" by
# returning these pre-registered confidential-client credentials. Register
# the confidential client once via Postman `Admin — create client` against
# the dev instance (Authorization: Bearer <Domo admin JWT>, body specifies
# grant_types=["client_credentials"], scope="ai:read ai:execute identity:read dataset:data:read").
DEV_INSTANCE_ISSUER_URL=http://domo-labs-dev.dev.domo.com:443
DEV_INSTANCE_CUSTOMER_ID=labs
DEV_INSTANCE_OAUTH_CLIENT_ID=<client_id from the admin-registered client>
DEV_INSTANCE_OAUTH_CLIENT_SECRET=<client_secret from same registration>
DEV_INSTANCE_SCOPES="ai:read ai:execute identity:read dataset:data:read"
```

### One-time: register the confidential client on the dev Domo instance

Gatekeeper rejects `client_credentials` clients from DCR — they have to be created via the admin endpoint. Do this once and save the credentials in `.env` as `DEV_INSTANCE_OAUTH_CLIENT_ID` + `DEV_INSTANCE_OAUTH_CLIENT_SECRET` above.

1. In Postman, set the collection variable `admin_token` to a Domo JWT or access token that carries `gateway.oauth.client.create` authority. (Your own Gatekeeper-issued access token works — get one via Postman items 2a → 4 → 5 the first time.)
2. Run **`Admin — create client`** with body:
   ```json
   {
     "client_name": "Huckleberry BFF — service",
     "grant_types": ["client_credentials"],
     "token_endpoint_auth_method": "client_secret_basic",
     "scope": "ai:read ai:execute identity:read dataset:data:read"
   }
   ```
3. Response contains `client_id` and `client_secret` (the secret is shown **once** — copy it now).

**Run**

```bash
# Terminal 1 — BFF on :3000
cd ~/dev/huckleberry-server && pnpm start:dev

# Terminal 2 — SPA on :5173 (Vite proxy forwards /api → :3000)
cd ~/dev/huckleberry && pnpm dev
```

### Path A — Self-service signup (the freemium demo)

1. Open `http://localhost:5173/login`.
2. Type any email (e.g. `demo@huckleberry.com`). Click **Send me a sign-in link**.
3. Watch Terminal 1 logs:
   ```
   [SignupService] provisioned instance for demo@huckleberry.com: ... (cid=labs)
   [ConsoleEmailService] [magic-link] url=http://localhost:5173/auth/signin?token=...
   ```
4. Click the magic-link URL. SPA consumes → `hb_session` + `csrf_token` cookies set → lands at `/workspace`.
5. DevTools console:
   ```js
   await fetch('/api/auth/me').then((r) => r.json());
   // → { success: true, data: { id, email, status: 'active', ... } }
   await fetch('/api/identity').then((r) => r.json());
   // → Domo user (the service-account identity)
   ```

### Path B — Operator-driven onboarding (for pilots / internal)

Same flow but go through `POST /api/admin/users` instead. The endpoint also auto-provisions via the stub, but is gated by `ADMIN_API_KEY`:

```bash
curl -X POST http://localhost:3000/api/admin/users \
  -H "Content-Type: application/json" \
  -H "x-admin-api-key: $(grep ^ADMIN_API_KEY= .env | cut -d= -f2)" \
  -d '{ "email": "pilot@huckleberry.com" }'
```

Response includes `magicLinkUrl` in dev mode.

### Sanity-checks

- Both cookies present on `localhost:5173` (DevTools → Application → Cookies).
- `/api/auth/me` returns `status: 'active'` immediately (no `pending_link`).
- `/api/identity` returns a Domo user — proves the broker minted a token via `client_credentials` and the BFF forwarded it through.
- Clear cookies + refresh → `AuthGuard` redirects to `/login?next=<path>`.

### Restart behavior

BFF restart wipes the in-memory stores (`users`, `magic_links`, `linked_domo_instances`, `domo_oauth_tokens`). After restart, any old magic-link is dead; the cookie is also dead (signing key may be re-derived if `SESSION_SIGNING_KEY` isn't set). Sign in again — the user gets re-created and re-provisioned in one shot.

**Failure modes**

| Symptom                                                                                              | Cause                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login` form returns 202 but BFF logs no `[magic-link]` line                                        | Provisioner failed silently. Check `[SignupService]` logs — most likely `DEV_INSTANCE_OAUTH_CLIENT_ID` / `_SECRET` missing in `.env`.          |
| `/login` returns 503 "Dev instance provisioner not configured"                                       | Same — missing `DEV_INSTANCE_*` env vars. See setup section above.                                                                             |
| `/auth/signin` returns `invalid_or_expired_token`                                                    | Magic link was already consumed (single-use), expired (15 min default), or BFF was restarted after issuance. Re-submit email at `/login`.       |
| `/api/auth/me` returns 401 after seemingly-good sign-in                                              | Cookie didn't stick. Confirm SPA URL is `localhost:5173` (not `127.0.0.1:5173`) and Vite proxy is active.                                       |
| `/api/identity` returns 401 "domo_link_required"                                                     | User has no linked instance. Shouldn't happen with freemium signup — re-onboard via `/login` to recreate the link.                              |
| `/api/identity` returns 401 from Domo                                                                | The dev confidential client's `client_secret` is wrong or revoked. Re-register via Postman `Admin — create client` and update `.env`.           |
| `/oauth2/token 400: invalid_scope`                                                                   | `DEV_INSTANCE_SCOPES` requests a scope the registered client doesn't have. Re-register the client with the wider scope set, or narrow the env. |
| BFF logs `Gatekeeper unreachable` or HTTP 400 with `plain HTTP request was sent to HTTPS port`       | `GATEKEEPER_TRANSPORT_URIS` not set. The dev instance signs HTTP issuers but transport is HTTPS; the override maps one to the other.            |

## API Endpoints

### Health

| Method | Path      | Description  |
| ------ | --------- | ------------ |
| `GET`  | `/health` | Health check |

### Agents — Custom Agent CRUD

> These endpoints operate on **Custom Agents** only (the `CustomAgent` resource in the Domo API). They do not list or manage built-in Domo agents.

| Method   | Path                       | Description                                                           |
| -------- | -------------------------- | --------------------------------------------------------------------- |
| `GET`    | `/agents`                  | List all custom agents from the in-memory cache                       |
| `POST`   | `/agents`                  | Create a new custom agent                                             |
| `POST`   | `/agents/refresh`          | Refresh the in-memory agent cache from Domo                           |
| `POST`   | `/agents/search`           | Search custom agents with filters, sort, and pagination               |
| `GET`    | `/agents/:agentId`         | Get a single agent by ID (supports `?include=all\|context\|toolkits`) |
| `PUT`    | `/agents/:agentId`         | Update a custom agent                                                 |
| `DELETE` | `/agents/:agentId`         | Delete a custom agent                                                 |
| `PATCH`  | `/agents/:agentId/context` | Incrementally add/remove agent context (datasources, cards, etc.)     |

### Agents — Execution (Streaming)

> Execute and resume work with **any agent** (custom or built-in) given its ID.

| Method | Path                                 | Description                              |
| ------ | ------------------------------------ | ---------------------------------------- |
| `POST` | `/agents/:agentId/execute/streaming` | Execute any agent by ID (SSE stream)     |
| `POST` | `/agents/:agentId/resume/streaming`  | Resume a paused agent by ID (SSE stream) |

### Huckleberry — Named Agent

> Convenience endpoints that resolve the Huckleberry agent by name from the cache so the client doesn't need to know the agent GUID (which may differ across environments).

| Method | Path                                    | Description                      |
| ------ | --------------------------------------- | -------------------------------- |
| `POST` | `/agents/huckleberry/execute/streaming` | Execute Huckleberry (SSE stream) |
| `POST` | `/agents/huckleberry/resume/streaming`  | Resume Huckleberry (SSE stream)  |

### AI Services

| Method | Path                       | Description                      |
| ------ | -------------------------- | -------------------------------- |
| `POST` | `/ai-services/chat`        | One-shot AI chat                 |
| `POST` | `/ai-services/chat/stream` | Streaming AI chat (SSE)          |
| `POST` | `/ai-services/generate`    | AI text generation               |
| `POST` | `/ai-services/summarize`   | AI summarization                 |
| `POST` | `/ai-services/sql`         | Natural language to SQL          |
| `POST` | `/ai-services/beastmode`   | BeastMode calculation generation |

## Authentication

In development (`NODE_ENV=development`), requests are authenticated with the `DEV_TOKEN` environment variable.

In production, the server expects one of:

- `x-domo-developer-token` header
- `x-domo-embedded-security` header (for Domo embedded app contexts)

## Architecture

```
src/
├── agents/              # Agent CRUD, execution, and Huckleberry named routes
├── ai-services/         # AI Services proxy (chat, generate, summarize, sql, beastmode)
├── common/
│   ├── config/          # Typed app configuration (AppConfig)
│   ├── constants/       # HTTP headers, agent name constants
│   ├── filters/         # DomoExceptionFilter — maps Domo errors to NestJS exceptions
│   ├── guards/          # DomoAuthGuard, AgentIdGuard
│   ├── interceptors/    # Request logging (verbose mode)
│   └── types/           # Domo API type definitions (agents, sessions, common)
├── domo-proxy/          # Global HTTP client for all outbound Domo API calls
├── health/              # Health check endpoint
└── main.ts              # Bootstrap, port management, shutdown hooks
public/
└── index.html           # Built-in API tester UI (served as static files)
```

## API Tester

The server includes a built-in API tester at `http://localhost:3000`. It provides a UI for testing all endpoints — including streaming — without needing an external tool like Postman.
