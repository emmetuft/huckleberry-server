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

| Variable | Required | Default | Description |
|---|---|---|---|
| `DOMO_INSTANCE_URL` | Yes | — | Domo instance base URL (e.g. `https://your-instance.domo.com`) |
| `DEV_TOKEN` | Yes (dev) | — | Domo developer token for local development |
| `NODE_ENV` | No | `development` | `development` or `production` |
| `PORT` | No | `3000` | HTTP listen port |
| `VERBOSE_LOGGING` | No | `false` | Log request/response bodies for outbound Domo calls and inbound requests |
| `HUCKLEBERRY_AGENT_ID` | Yes | — | Domo agent GUID for the Huckleberry embedded agent (differs per environment) |

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

## Testing

```bash
pnpm test               # unit tests
pnpm test:e2e           # all end-to-end tests
pnpm test:auth          # magic-link auth flow e2e only
pnpm test:cov           # coverage report
pnpm demo:auth          # live demo of the sign-in flow (needs a running BFF)
```

## API Endpoints

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |

### Agents — Custom Agent CRUD

> These endpoints operate on **Custom Agents** only (the `CustomAgent` resource in the Domo API). They do not list or manage built-in Domo agents.

| Method | Path | Description |
|---|---|---|
| `GET` | `/agents` | List all custom agents from the in-memory cache |
| `POST` | `/agents` | Create a new custom agent |
| `POST` | `/agents/refresh` | Refresh the in-memory agent cache from Domo |
| `POST` | `/agents/search` | Search custom agents with filters, sort, and pagination |
| `GET` | `/agents/:agentId` | Get a single agent by ID (supports `?include=all\|context\|toolkits`) |
| `PUT` | `/agents/:agentId` | Update a custom agent |
| `DELETE` | `/agents/:agentId` | Delete a custom agent |
| `PATCH` | `/agents/:agentId/context` | Incrementally add/remove agent context (datasources, cards, etc.) |

### Agents — Execution (Streaming)

> Execute and resume work with **any agent** (custom or built-in) given its ID.

| Method | Path | Description |
|---|---|---|
| `POST` | `/agents/:agentId/execute/streaming` | Execute any agent by ID (SSE stream) |
| `POST` | `/agents/:agentId/resume/streaming` | Resume a paused agent by ID (SSE stream) |

### Huckleberry — Named Agent

> Convenience endpoints that resolve the Huckleberry agent by name from the cache so the client doesn't need to know the agent GUID (which may differ across environments).

| Method | Path | Description |
|---|---|---|
| `POST` | `/agents/huckleberry/execute/streaming` | Execute Huckleberry (SSE stream) |
| `POST` | `/agents/huckleberry/resume/streaming` | Resume Huckleberry (SSE stream) |

### AI Services

| Method | Path | Description |
|---|---|---|
| `POST` | `/ai-services/chat` | One-shot AI chat |
| `POST` | `/ai-services/chat/stream` | Streaming AI chat (SSE) |
| `POST` | `/ai-services/generate` | AI text generation |
| `POST` | `/ai-services/summarize` | AI summarization |
| `POST` | `/ai-services/sql` | Natural language to SQL |
| `POST` | `/ai-services/beastmode` | BeastMode calculation generation |

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
