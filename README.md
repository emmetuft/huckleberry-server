# Huckleberry Server

NestJS Backend-for-Frontend (BFF) that proxies Domo Agent APIs and provides named-agent endpoints for the Huckleberry AI assistant. Standalone SaaS — owns its own identity (Layer A: magic-link sign-in) and links each user to a Domo instance via PKCE OAuth (Layer B).

## Prerequisites

- Assumed installed: **Node 20+**, **npm**, **Homebrew**.
- This repo adds: **pnpm 10** (via Corepack) and **Podman 5+** (FOSS Docker alternative). One-line install + bring-up in **[`docs/local-development.md`](docs/local-development.md)** § Prerequisites.
- Access to a Domo instance with the AI Services features enabled (see next section). If you don't have access to flip them, the Domo team does.

### Required Domo instance flags (instance-side, **not local**)

These must be enabled on the target Domo instance for the Agent APIs to respond. They have no local equivalent — toggling them on `localhost` does nothing:

```bash
tug-eks set feature -f ai-services -s true
tug-eks set feature -f ai-services-assistants -s true
tug-eks set feature -f ai-services-conversational-agent -s true
tug-eks set feature -f ai-services-domo-gpt -s true
tug-eks set feature -f ai-assistant-tool-calling -s true
```

Without them, agent search/execute endpoints return `403` with code `DS-0049` ("Required AI Services features are not all enabled").

## Setup

```bash
corepack enable
podman machine init && podman machine start
corepack pnpm install
cp .env.example .env                  # edit per the table in docs/local-development.md
pnpm infra:up                         # boot MySQL + Mailpit containers
pnpm start:dev                        # BFF; runs migrations on first boot
```

Full one-time-setup + day-to-day workflow + troubleshooting lives in **[`docs/local-development.md`](docs/local-development.md)**. AWS deployment runbook (ECS + CD pipeline + IAM): **[`docs/deployment-bff.md`](docs/deployment-bff.md)**.

> This project uses **pnpm** exclusively. `pnpm-lock.yaml` is the source of truth; `package-lock.json` and `yarn.lock` are gitignored.

## Local MySQL

Local container is `mysql:8.4` — same version as our Aurora target, so reserved-word and removed-deprecated-feature mismatches surface locally instead of at deploy. Schema in `src/common/db/schema.ts`, migrations under `./drizzle/`. Infra lifecycle: `pnpm infra:up|down|reset`. Schema-only: `pnpm db:migrate|generate|studio`. When `DATABASE_URL` is unset the BFF falls back to in-memory repositories (used by tests). Workflow + troubleshooting in [`docs/local-development.md`](docs/local-development.md).

## Authentication

Two distinct layers:

- **Layer A — huckleberry identity.** Magic-link sign-in, server-issued `hb_session` cookie, CSRF double-submit token. Sign-up is self-service: provisions a Domo instance via `InstanceProvisioner` and seeds the user as `pending_link`. Sign-in is existing-users-only.
- **Layer B — Domo OAuth linkage.** Public PKCE auth-code flow against Gatekeeper. The BFF holds no `client_secret`; only per-user refresh tokens. Bearer is minted on demand and forwarded to Domo with the user's identity (`sub`, `cid`, scope) baked in.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/auth/signup` | public | Provision instance + create user (`pending_link`) + email magic-link. |
| `POST /api/auth/signin/request` | public | Email a magic-link if the address has an account. Always 202 (no existence oracle). |
| `GET /api/auth/signin?token=...` | public | Consume magic-link → set `hb_session` + `csrf_token` cookies. |
| `POST /api/auth/domo/link/start` | session | Start PKCE — returns the Gatekeeper authorize URL. |
| `GET /api/auth/domo/callback?code&state` | public | Exchange code, persist refresh token, flip user to `active`. |
| `POST /api/auth/logout` | session + CSRF | Revoke the session. |
| `GET /api/auth/me` | session | Current user, or 401. |
| `POST /api/admin/users` | `x-admin-api-key` | Operator-driven onboarding. Same shape as `/signup`. |

Design rationale, schema, multi-tenant story: **[`docs/authentication.md`](docs/authentication.md)** and `docs/diagrams/oauth-flow.md`. Per-laptop demo walkthrough: [`docs/local-development.md`](docs/local-development.md) § End-to-end sign-up flow.

## Testing

```bash
pnpm test               # unit tests (in-memory repos — no Docker required)
pnpm test:auth          # Layer A e2e (magic-link → session → CSRF → logout → revocation), ~1s
pnpm test:e2e           # full e2e suite including the live Gatekeeper spec (auto-skips without GATEKEEPER_TEST_TOKEN)
pnpm test:cov           # coverage report
pnpm demo:auth          # live sign-in demo via curl against a running BFF (no browser, no SPA)
```

## API Endpoints

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |

### Agents — Custom Agent CRUD

Operates on **Custom Agents** only (the `CustomAgent` resource). Does not list or manage built-in Domo agents.

| Method | Path | Description |
|---|---|---|
| `GET` | `/agents` | List all custom agents from the in-memory cache |
| `POST` | `/agents` | Create a new custom agent |
| `POST` | `/agents/refresh` | Refresh the in-memory agent cache from Domo |
| `POST` | `/agents/search` | Search custom agents with filters, sort, and pagination |
| `GET` | `/agents/:agentId` | Get a single agent by ID (supports `?include=all\|context\|toolkits`) |
| `PUT` | `/agents/:agentId` | Update a custom agent |
| `DELETE` | `/agents/:agentId` | Delete a custom agent |
| `PATCH` | `/agents/:agentId/context` | Incrementally add/remove agent context |

### Agents — Execution (streaming)

Execute or resume any agent (custom or built-in) by ID.

| Method | Path | Description |
|---|---|---|
| `POST` | `/agents/:agentId/execute/streaming` | Execute any agent by ID (SSE) |
| `POST` | `/agents/:agentId/resume/streaming` | Resume a paused agent by ID (SSE) |

### Huckleberry — named agent

Convenience endpoints that resolve the Huckleberry agent by name from the cache, so the client doesn't need the GUID (which differs across environments).

| Method | Path | Description |
|---|---|---|
| `POST` | `/agents/huckleberry/execute/streaming` | Execute Huckleberry (SSE) |
| `POST` | `/agents/huckleberry/resume/streaming` | Resume Huckleberry (SSE) |

### AI Services

| Method | Path | Description |
|---|---|---|
| `POST` | `/ai-services/chat` | One-shot AI chat |
| `POST` | `/ai-services/chat/stream` | Streaming AI chat (SSE) |
| `POST` | `/ai-services/generate` | AI text generation |
| `POST` | `/ai-services/summarize` | AI summarization |
| `POST` | `/ai-services/sql` | Natural language to SQL |
| `POST` | `/ai-services/beastmode` | BeastMode calculation generation |

## Architecture

```
src/
├── agents/              Agent CRUD, execution, Huckleberry named routes
├── ai-services/         AI Services proxy
├── auth/                Layer A — magic-link, sessions, signup, admin onboarding
├── common/
│   ├── auth/            Layer B — DomoAuthBroker, PKCE client, JWKS, link state
│   ├── config/          Typed AppConfig
│   ├── constants/       HTTP headers, agent name constants
│   ├── db/              Drizzle schema, DbModule, MySQL repositories, migrate runner
│   ├── filters/         DomoExceptionFilter — maps Domo errors → NestJS exceptions
│   ├── guards/          DomoAuthGuard (session-only inbound auth)
│   └── interceptors/    Request logging (verbose mode)
├── connectors/          Domo connector listing
├── datasources/         Dataset CRUD + query passthrough
├── domo-proxy/          Global outbound Domo HTTP client (per-request bearer via ALS)
├── identity/            Domo identity lookup for the signed-in user
├── mcp/                 MCP server config (in-memory; Aurora-bound future)
├── people/              Domo users / groups
├── personas/            Persona CRUD (in-memory; Aurora-bound future)
├── sessions/            AI session bookkeeping
├── toolkits/            AI toolkits passthrough
└── main.ts              Bootstrap, port management, shutdown hooks
drizzle/                 Generated SQL migrations (committed)
docker-compose.yml       Local MySQL container (Podman/Docker compatible)
docs/                    authentication.md · local-development.md · diagrams/
scripts/                 demo-auth.sh · gatekeeper-scope-repro.sh · onboard-user.ts
```

## API tester

Built-in tester at `http://localhost:3000` — UI for hitting every endpoint (including streaming) without Postman.
