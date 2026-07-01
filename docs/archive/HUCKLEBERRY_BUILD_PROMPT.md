# Huckleberry Server — Build Prompt

## Context

You are building out `~/dev/huckleberry-server`, a NestJS BFF (Backend-for-Frontend) server
that acts as the intelligence layer between the Huckleberry frontend (`~/dev/huckleberry`)
and the Domo AI platform.

The server currently proxies the Domo Agent API and AI Services API. It is missing the
four core modules that make Huckleberry a true "brain": **ontology**, **context**, **personas**, and **MCP**.

Use `~/dev/huckleberry/src/` as your primary reference. The patterns, types, and service contracts
defined there represent what this server needs to expose as NestJS modules.

---

## Existing Structure

```
huckleberry-server/src/
├── agents/          # Agent CRUD, execution, streaming — COMPLETE
├── ai-services/     # Domo AI Services proxy — COMPLETE
├── common/          # Guards, interceptors, filters, types, config — COMPLETE
├── domo-proxy/      # HTTP client for Domo API — COMPLETE
├── health/          # Health check — COMPLETE
├── app.module.ts
└── main.ts
```

The existing NestJS module pattern to follow (controller / service / module):

- Reference `src/agents/agents.controller.ts`, `agents.service.ts`, `agents.module.ts`
- All modules use `DomoProxyService` for Domo API calls or their own HTTP/DB clients
- DTOs use `class-validator` decorators, typed with `class-transformer`
- Streaming uses `Readable.fromWeb()` piped to Express response

---

## What to Build

### 1. Ontology Module (`/ontology`)

**Reference:** `~/dev/huckleberry/src/services/neo4j.ts`

This service exposes Neo4j graph query operations. In `~/dev/huckleberry`, the frontend
calls these at `/api/ontology/*`. This module moves that logic server-side as a NestJS module.

**Endpoints to implement:**

| Method | Path                                         | Description                                                       |
| ------ | -------------------------------------------- | ----------------------------------------------------------------- |
| GET    | `/ontology/labels`                           | Fetch all node labels from the graph                              |
| POST   | `/ontology/nodes`                            | Fetch nodes with optional label, filter, and relationship options |
| GET    | `/ontology/subgraph/:nodeId`                 | Fetch a subgraph starting from a node (depth, limit params)       |
| GET    | `/ontology/search`                           | Full-text node search (query, limit params)                       |
| GET    | `/ontology/property-values/:label/:property` | Fetch unique property values for a label/property                 |

**Service contract (from `neo4j.ts`):**

```typescript
// POST /ontology/nodes body shape
interface FetchNodesParams {
  labels?: string[];
  filters?: any[];
  limit?: number;
  includeRelationships?: boolean;
}

// GET /ontology/subgraph/:nodeId query params
// depth: number (default 2), limit: number (default 500)

// GET /ontology/search query params
// query: string, limit: number (default 100)

// GET /ontology/property-values/:label/:property query params
// limit: number (default VALUE_QUERY_LIMIT)
```

**Response shape:** All endpoints return `{ success: boolean, data: GraphData | any, error?: string }`

**Implementation notes:**

- The ontology service should connect to a Neo4j instance via environment variables:
  `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`
- Use the official `neo4j-driver` package (`pnpm add neo4j-driver`)
- Create an `OntologyModule` that provides a `Neo4jService` for the driver connection
  and an `OntologyService` for query execution
- All Cypher queries should be parameterized (no string interpolation)
- The `GraphData` type should match what the frontend expects:
  ```typescript
  interface GraphData {
    nodes: Neo4jNode[];
    relationships: Neo4jRelationship[];
  }
  interface Neo4jNode {
    id: string;
    labels: string[];
    properties: Record<string, any>;
  }
  interface Neo4jRelationship {
    id: string;
    type: string;
    startNodeId: string;
    endNodeId: string;
    properties: Record<string, any>;
  }
  ```

---

### 2. Context Module (`/context`)

**Reference:** `~/dev/huckleberry/src/services/context.ts`

This is the most important missing piece. The context module assembles the rich prompt
context (ontology + persona + intent) before an agent call, then streams the result.

In `~/dev/huckleberry`, the frontend calls `/api/context/query-stream` with a `UserRequest`
and receives a stream of `StreamMessage` events.

**Endpoints to implement:**

| Method | Path                    | Description                                                        |
| ------ | ----------------------- | ------------------------------------------------------------------ |
| POST   | `/context/query-stream` | Assemble context + execute Huckleberry agent, SSE stream           |
| POST   | `/context/assemble`     | Assemble context for a query (no execution, returns context block) |

**Request/Response contracts (from `context.ts` and `models/interfaces/userRequest`):**

```typescript
// POST /context/query-stream body
interface UserRequest {
  input: string;
  sessionId?: string;
  personaId?: string; // optional: which persona to use
  ontologyDepth?: number; // how deep to traverse ontology for context (default 2)
}

// SSE stream events yielded
interface StreamMessage {
  type: StreamType;
  content?: string;
  message?: string;
  context?: GraphContext; // assembled ontology + persona snapshot
  step?: ProcessStep;
  tool?: ToolEventData;
}
```

**What context assembly does:**

1. Take the user's `input`
2. Search the ontology graph for relevant nodes (`searchNodes(input)`)
3. Load the active persona (by `personaId` or default)
4. Classify intent from input (simple keyword/heuristic classification is fine initially)
5. Assemble `ontologyContext`, `personaConfig`, `intentClass`, `dataMappings` strings
6. Inject these into the Huckleberry agent execution request as context params
7. Pipe the Domo agent SSE stream back to the caller, prepending a `CONTEXT` event
   with the assembled context snapshot

**Context assembly output shape:**

```typescript
interface GraphContext {
  entities: Array<{
    id: string;
    label: string;
    name: string;
    properties: Record<string, any>;
  }>;
  relationships: Array<{ from: string; to: string; type: string }>;
  intent: string;
  persona?: {
    role: string;
    department: string;
    focusAreas: string[];
    goals: string;
  };
}
```

**Implementation notes:**

- `ContextService` depends on `OntologyService` (for graph search) and `PersonasService` (for persona lookup)
- The assembled context strings get passed as additional fields in `AssistantExecutionRequest.context`
- For the initial intent classifier, use simple string matching on keywords:
  - analytics_query: "how many", "total", "revenue", "metric", "trend", "compare"
  - data_exploration: "show me", "what is", "explore", "list", "find", "related to"
  - action_initiation: "create", "update", "run", "trigger", "automate", "send"
  - explanation: "explain", "describe", "what does", "tell me about"
  - summarization: "summarize", "summary", "overview", "brief", "recap"

---

### 3. Personas Module (`/personas`)

**Reference:** `~/dev/huckleberry/src/constants/persona.ts`

Personas define who the user is — their role, department, focus areas, and goals.
This drives how Huckleberry tailors responses. Currently hardcoded on the frontend;
this module makes them persistent and manageable server-side.

**Endpoints to implement:**

| Method | Path                    | Description              |
| ------ | ----------------------- | ------------------------ |
| GET    | `/personas`             | List all personas        |
| POST   | `/personas`             | Create a new persona     |
| GET    | `/personas/:id`         | Get a persona by ID      |
| PUT    | `/personas/:id`         | Update a persona         |
| DELETE | `/personas/:id`         | Delete a persona         |
| GET    | `/personas/default`     | Get the default persona  |
| PATCH  | `/personas/:id/default` | Set a persona as default |

**Persona shape (from `persona.ts` and `models/interfaces/persona.ts`):**

```typescript
interface Persona {
  id: string; // UUID
  name: string; // display name for the persona
  role: string; // e.g. "Chief Marketing Officer"
  level: RoleLevel; // C_LEVEL | VP | DIRECTOR | MANAGER | INDIVIDUAL_CONTRIBUTOR
  department: string; // from groupedDepartments list
  team?: string;
  focusAreas: string[]; // from focusAreas list in constants/persona.ts
  strengths: string[]; // from strengthsList
  weaknesses: string[]; // from weaknessesList
  goals: string; // free text goal statement
  isDefault: boolean;
  usePersona: boolean; // whether to inject this persona into agent context
  useActivity: boolean; // whether to inject user activity context
  useData: boolean; // whether to inject data context
  createdAt: string;
  updatedAt: string;
}

enum RoleLevel {
  C_LEVEL = 'C_LEVEL',
  VP = 'VP',
  DIRECTOR = 'DIRECTOR',
  MANAGER = 'MANAGER',
  INDIVIDUAL_CONTRIBUTOR = 'INDIVIDUAL_CONTRIBUTOR',
}
```

**Persona → prompt string serialization:**
When assembling context, a persona should be serialized to a prompt-friendly string:

```
Role: Chief Marketing Officer (C-Level)
Department: Marketing | Team: Marketing
Focus Areas: Campaign Performance, Customer Segmentation, Time to Market
Strengths: Leadership, Collaboration, Decision Making
Goals: Attract 3 major news publishers for Domopalooza 2026
```

**Implementation notes:**

- Use in-memory storage initially (a `Map<string, Persona>`) with a seed default persona
  matching the `defaultPersona` from `~/dev/huckleberry/src/constants/persona.ts`
- Later: persist to a database (SQLite via TypeORM is a lightweight option)
- The `PersonasService` must be injectable into `ContextService`
- Seed data: use the `defaultPersona` constant as the initial default

---

### 4. MCP Module (`/mcp`)

**Reference:** `~/dev/huckleberry/src/services/mcp.ts`

The MCP (Model Context Protocol) module manages external tool servers that extend
Huckleberry's capabilities. The frontend currently calls these at `/api/mcp/*`.

**Endpoints to implement — Server management:**

| Method | Path                      | Description                                     |
| ------ | ------------------------- | ----------------------------------------------- |
| GET    | `/mcp/servers`            | List all MCP servers (optional `?enabled=true`) |
| POST   | `/mcp/servers`            | Register a new MCP server                       |
| GET    | `/mcp/servers/:id`        | Get a server by ID                              |
| PUT    | `/mcp/servers/:id`        | Update a server                                 |
| DELETE | `/mcp/servers/:id`        | Delete a server                                 |
| POST   | `/mcp/servers/:id/test`   | Test connection to a server                     |
| POST   | `/mcp/servers/:id/sync`   | Sync tool definitions from a server             |
| PATCH  | `/mcp/servers/:id/toggle` | Enable or disable a server                      |

**Endpoints to implement — Tools:**

| Method | Path                 | Description                             |
| ------ | -------------------- | --------------------------------------- |
| GET    | `/mcp/tools`         | List all tools from all enabled servers |
| POST   | `/mcp/tools/execute` | Execute a tool on a specific server     |

**Endpoints to implement — OAuth2:**

| Method | Path                              | Description                        |
| ------ | --------------------------------- | ---------------------------------- |
| GET    | `/mcp/oauth2/authorize/:serverId` | Initiate OAuth2 authorization flow |
| POST   | `/mcp/oauth2/revoke/:serverId`    | Revoke OAuth2 credentials          |
| GET    | `/mcp/oauth2/status/:serverId`    | Get OAuth2 authorization status    |
| POST   | `/mcp/oauth2/discover/:serverId`  | Discover OAuth2 configuration      |

**Type contracts (from `models/interfaces/mcpServer.ts`):**

```typescript
interface MCPServerConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  authType: 'none' | 'bearer' | 'oauth2';
  bearerToken?: string;
  oauth2Config?: OAuth2Config;
  tools?: MCPToolDefinition[];
  createdAt: string;
  updatedAt: string;
}

interface MCPToolDefinition {
  serverId: string;
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

interface MCPTestConnectionResult {
  connected: boolean;
  toolCount?: number;
  error?: string;
}

interface MCPToolResult {
  success: boolean;
  data?: any;
  error?: string;
}
```

**Implementation notes:**

- Use in-memory storage initially (`Map<string, MCPServerConfig>`)
- Tool execution: make a POST to the MCP server's tool endpoint following the MCP protocol spec
- Connection test: attempt to fetch the server's tool list and return success/failure
- OAuth2 flow: store tokens in memory initially; the `authorize` endpoint returns a redirect URL

---

## Module Registration

After building each module, register it in `app.module.ts`:

```typescript
import { OntologyModule } from './ontology/ontology.module.js';
import { ContextModule } from './context/context.module.js';
import { PersonasModule } from './personas/personas.module.js';
import { McpModule } from './mcp/mcp.module.js';

@Module({
  imports: [
    // ... existing modules
    OntologyModule,
    ContextModule,
    PersonasModule,
    McpModule,
  ],
})
export class AppModule {}
```

---

## Environment Variables to Add

Add to `.env` and `src/common/config/configuration.ts`:

```env
# Neo4j (for Ontology module)
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password
NEO4J_DATABASE=neo4j
```

---

## Build Order

Build in this dependency order (later modules depend on earlier ones):

1. **Ontology** — no dependencies, self-contained Neo4j client
2. **Personas** — no dependencies, in-memory CRUD
3. **MCP** — no dependencies, external HTTP calls
4. **Context** — depends on Ontology + Personas, orchestrates agent execution

---

## Key Files to Reference

All in `~/dev/huckleberry/`:

| Reference file               | What it tells you                                 |
| ---------------------------- | ------------------------------------------------- |
| `src/services/neo4j.ts`      | Ontology API contracts and query patterns         |
| `src/services/context.ts`    | Context streaming shape and UserRequest type      |
| `src/services/mcp.ts`        | Full MCP API surface and OAuth2 flows             |
| `src/constants/persona.ts`   | Persona structure, defaults, and vocabulary lists |
| `src/constants/mapping.ts`   | Data alias and schema mapping patterns            |
| `src/models/enums/stream.ts` | StreamType enum values                            |
| `src/models/interfaces/`     | All TypeScript interface definitions              |

---

## Existing NestJS Patterns to Follow

In `~/dev/huckleberry-server/src/agents/`:

- `agents.controller.ts` — controller pattern with guards, DTOs, streaming
- `agents.service.ts` — service pattern with `OnModuleInit`, logging, typed returns
- `agents.module.ts` — module wiring pattern

In `~/dev/huckleberry-server/src/common/`:

- `guards/domo-auth.guard.ts` — apply `@UseGuards(DomoAuthGuard)` to all new controllers
- `filters/domo-exception.filter.ts` — use `DomoApiError` for upstream errors
- `config/configuration.ts` — add new env vars here following the existing typed pattern
