# Requirements: Domo Agent Integration (v0 MVP)

## Introduction

Replace the custom Express.js backend with Domo's first-party Agent APIs (`/api/ai/v1/agents/`). The frontend will communicate directly with Domo's agent infrastructure for AI orchestration, tool execution, and streaming responses — eliminating the need for a custom backend server.

This is a v0 MVP focused on getting to a working product quickly by leveraging what Domo provides out of the box rather than building custom infrastructure.

## What Domo Provides (and what we stop building)

| Capability                | Current (Custom)                     | New (Domo Agent)                                                         |
| ------------------------- | ------------------------------------ | ------------------------------------------------------------------------ |
| LLM orchestration         | Custom contextBuilder service        | Domo Agent execute/streaming                                             |
| Tool execution            | Custom MCP tool service + ReAct loop | Domo Toolkits (CodeEngine, Domo, Workflow, MCP tools)                    |
| Streaming                 | Custom SSE from Express              | Domo SSE via `/agents/{agentId}/execute/streaming`                       |
| Agent config              | Custom prompts in code               | `CustomAgent` resource (name, prompt, systemMessage, context, toolkits)  |
| Session management        | Custom conversation service + AppDB  | Domo sessions (sessionId UUID, resume support)                           |
| Context (datasources)     | Custom datasource service            | `AgentContext.dataSourceIds` on agent config                             |
| Context (file sets)       | Custom file service                  | `AgentContext.fileSets` on agent config                                  |
| Permissions               | None (dev token)                     | `CustomAgentAccess` (OWNER, EDIT, READ, NONE)                            |
| Tool pausing/confirmation | Not supported                        | `AssistantPausedEvent`, `RequestConfirmationEvent`, `AgentResumeRequest` |

## What the frontend must adapt to

| Concern             | Change Required                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| SSE events          | Replace custom `StreamType` enum with Domo event types (see Req 3)                                       |
| Chat request        | Replace `UserRequest` with `AssistantExecutionRequest` (input, sessionId, aiAssistantContext, agentType) |
| Session continuity  | Use Domo `sessionId` (UUID) instead of custom conversationId + rolling summaries                         |
| Processing steps    | Map from Domo's `ActionStartedEvent`/`ActionCompletedEvent`/`ToolStartedEvent`/`ToolCompletedEvent`      |
| Response streaming  | Map from `AssistantResponseStartEvent` → `AssistantResponseChunkEvent` → `AssistantResponseEndEvent`     |
| Tool results        | Surface `ActionCompletedEvent.outputs` and `ToolCompletedEvent` data                                     |
| Agent configuration | New admin UI for agent CRUD via Domo API (or configure once and hardcode agentId)                        |

---

## Requirements

### Requirement 1: Domo Agent Service Layer

**User Story:** As a developer, I want a typed service layer for the Domo Agent API, so that the frontend can interact with agents through a clean, well-defined interface.

> **Note:** The CRUD and search endpoints under `/api/ai/v1/agents` operate on **Custom Agents** only (the `CustomAgent` resource in the Domo OpenAPI spec). The execute and resume streaming endpoints, however, work with any agent — custom or otherwise — given its `agentId`.

#### Acceptance Criteria

1. WHEN the app initializes THEN the system SHALL have a `DomoAgentService` that wraps the Domo Agent REST API with typed methods
2. WHEN `createAgent()` is called THEN the system SHALL POST to `/api/ai/v1/agents` with a `CreateCustomAgentRequest` (name, prompt, systemMessage, context, toolkitIds)
3. WHEN `getAgent(agentId)` is called THEN the system SHALL GET `/api/ai/v1/agents/{agentId}` with optional `include` query param (all, context, toolkits, none)
4. WHEN `updateAgent(agentId, request)` is called THEN the system SHALL PUT to `/api/ai/v1/agents/{agentId}` with an `UpdateCustomAgentRequest`
5. WHEN `deleteAgent(agentId)` is called THEN the system SHALL DELETE `/api/ai/v1/agents/{agentId}`
6. WHEN `searchAgents(query)` is called THEN the system SHALL POST to `/api/ai/v1/agents/search` with filters, sort, and pagination
7. WHEN any API call fails THEN the system SHALL surface typed errors (403 Forbidden, 409 Conflict) to the caller

---

### Requirement 2: Agent Execution and Streaming

**User Story:** As a user, I want to send messages to an agent and receive streamed AI responses with real-time processing updates, so that I see progress while the agent works.

#### Acceptance Criteria

1. WHEN the user sends a message THEN the system SHALL POST to `/api/ai/v1/agents/{agentId}/execute/streaming` with an `AssistantExecutionRequest` containing: `input` (user's message), `sessionId` (UUID for conversation continuity), `aiAssistantContext` (optional context overrides), and optionally `model` and `agentType`
2. WHEN the SSE stream begins THEN the system SHALL parse events using their discriminator type and route them to the appropriate UI handler
3. WHEN `AssistantResponseStartEvent` is received THEN the system SHALL indicate that the AI is beginning to respond
4. WHEN `AssistantResponseChunkEvent` is received THEN the system SHALL append `output` to the streaming message display
5. WHEN `AssistantResponseEndEvent` is received THEN the system SHALL mark the response as complete
6. WHEN `ActionStartedEvent` is received THEN the system SHALL display a processing step with the tool name and inputs
7. WHEN `ActionCompletedEvent` is received THEN the system SHALL update the processing step with outputs, duration, and source references
8. WHEN `ToolStartedEvent` is received THEN the system SHALL show tool execution in progress
9. WHEN `ToolCompletedEvent` is received THEN the system SHALL show tool execution results
10. WHEN `AssistantPausedEvent` is received THEN the system SHALL indicate the agent is paused (user-in-the-loop)
11. WHEN `RequestConfirmationEvent` is received THEN the system SHALL prompt the user for confirmation before the agent continues
12. WHEN the user provides confirmation THEN the system SHALL POST to `/api/ai/v1/agents/{agentId}/resume/streaming` with an `AgentResumeRequest`
13. WHEN `AIHeartbeatEvent` is received THEN the system SHALL treat it as a keep-alive (no UI update)
14. WHEN an error event is received THEN the system SHALL display the error and close the stream gracefully

---

### Requirement 3: SSE Event Type Mapping

**User Story:** As a developer, I want typed SSE event definitions matching the Domo Agent API, so that I can handle all event types safely and exhaustively.

#### Acceptance Criteria

1. WHEN SSE events are defined THEN the system SHALL use TypeScript discriminated unions (or enums) for all Domo event types:
   - `AIDurationEvent` — timing metrics
   - `AIHeartbeatEvent` — keep-alive
   - `AIInsightEvent` — AI insights
   - `AIServiceRequestEvent` / `AIServiceResponseEvent` — internal service calls
   - `AIWarningEvent` — warnings
   - `ActionCardChunkEvent` — card rendering chunks
   - `ActionCompletedEvent` — action finished (with `actionType` enum, `outputs`, `durationMs`, `sourceReferences`)
   - `ActionPromptEvent` — action input prompt
   - `ActionRequestEvent` — action request details
   - `ActionStartedEvent` — action started (with `tool` name, `inputs`)
   - `AssistantPausedEvent` — agent paused for user input
   - `AssistantRequestEvent` — request echo
   - `AssistantResponseChunkEvent` — streaming text chunk (`output` field)
   - `AssistantResponseEndEvent` — stream complete
   - `AssistantResponseEvent` — full response (non-streaming)
   - `AssistantResponseStartEvent` — stream starting
   - `AssistantResumedEvent` — agent resumed after pause
   - `CancelEvent` — cancellation
   - `FileGeneratedEvent` — file output
   - `McpNotificationEvent` / `McpRequestEvent` / `McpResponseEvent` — MCP protocol events
   - `RequestConfirmationEvent` — user confirmation needed
   - `ToolCompletedEvent` / `ToolPausedEvent` / `ToolResumedEvent` / `ToolStartedEvent` — toolkit tool lifecycle
2. WHEN events share common fields THEN the system SHALL define a base `AISessionEvent` type with `sessionId`, `requestId`, `parentEventId`, `eventId`, `timestamp`, `error`, `toe`
3. WHEN `ActionCompletedEvent` is received THEN its `actionType` field SHALL be typed as an enum with values like `dataset_text_to_sql_action`, `code_engine_execution_action`, `kb_query_action`, `generic_tool_action`, etc.

---

### Requirement 4: Session and Conversation Management

**User Story:** As a user, I want my conversations to persist across page loads, so that I can continue previous discussions.

#### Acceptance Criteria

1. WHEN a new conversation starts THEN the system SHALL generate a UUID `sessionId` and use it for all messages in that conversation
2. WHEN the user sends a follow-up message THEN the system SHALL reuse the same `sessionId` to maintain conversation context on the Domo side
3. WHEN the user returns to a previous conversation THEN the system SHALL restore the `sessionId` and message history from local state
4. WHEN session context is needed THEN the system SHALL call `GET /api/ai/v1/assistant/sessions/{sessionId}/context` to retrieve the session's context details
5. IF conversation persistence beyond the browser session is needed THEN the system SHALL store conversation metadata (sessionId, title, messages, timestamps) in a lightweight store (AppDB or localStorage for MVP)

---

### Requirement 5: Agent Context Configuration

**User Story:** As a developer, I want to configure what data sources, cards, pages, and file sets the agent has access to, so that responses are grounded in the right data.

#### Acceptance Criteria

1. WHEN an agent is created or updated THEN the system SHALL configure its `AgentContext` with:
   - `dataSourceIds` — Domo dataset IDs the agent can query
   - `cardIds` — Domo card URNs for card context
   - `pageIds` — Domo page IDs for page context
   - `ignorableDataSourceIds` — datasets to exclude
   - `fileSets` — file set references (uploaded documents, external docs)
   - `dateRangeFilter` — optional date range constraints
   - `descriptions` — key-value descriptions for context items
2. WHEN sending a request THEN the system MAY override agent-level context with per-request `aiAssistantContext` on the `AssistantExecutionRequest`
3. WHEN context needs to be updated incrementally THEN the system SHALL use `AgentContextUpdateRequest` with `add` and `remove` fields (not full replacement)

---

### Requirement 6: Toolkit Integration

**User Story:** As a developer, I want the agent to use Domo Toolkits for tool execution, so that it can query data, run code, and invoke workflows.

#### Acceptance Criteria

1. WHEN an agent is created THEN the system SHALL assign `toolkitIds` linking it to one or more Domo Toolkits
2. WHEN toolkits need to be managed THEN the system SHALL use the Toolkit API (`/api/ai/v1/toolkits`) for CRUD operations
3. WHEN a toolkit is created THEN it SHALL specify tool type(s): `CreateCodeEngineToolRequest`, `CreateDomoToolRequest`, or `CreateWorkflowToolRequest`
4. WHEN a toolkit has context THEN it SHALL use `ToolkitContext` with `ToolkitContextEntry` items (CARD, DATASOURCE, FILTER, PAGE, FILESET, DATE_RANGE_FILTER)
5. WHEN MCP-based toolkits are needed THEN the system SHALL use the MCP toolkit endpoint (`/api/ai/v1/assistant/mcp/toolkits/{toolkitId}`) which supports JSON-RPC 2.0 via streamable HTTP

---

### Requirement 7: Agent Type Selection

**User Story:** As a developer, I want to configure the agent's execution strategy, so that I can optimize for different use cases.

#### Acceptance Criteria

1. WHEN executing an agent THEN the system SHALL support the `agentType` field with values: `REACT`, `REWOO`, `SINGLE_TOOL`, `TOOL_CALLING`, `MCP`, `UNKNOWN`
2. WHEN no `agentType` is specified THEN the system SHALL use the agent's default strategy
3. WHEN `agentType` overrides are needed per-request THEN the system SHALL pass the override in `AssistantExecutionRequest.agentType` or `AgentResumeRequest.agentStrategy`

---

### Requirement 8: Frontend State Management Refactor

**User Story:** As a developer, I want the Redux chat state updated to reflect Domo Agent concepts, so that the UI correctly represents the new data flow.

#### Acceptance Criteria

1. WHEN the chat state is defined THEN it SHALL track: `sessionId` (UUID), `agentId` (string), messages, streaming state, and processing steps
2. WHEN processing steps are displayed THEN they SHALL map from Domo's event model:
   - `ActionStartedEvent` → step starts (with tool name)
   - `ActionCompletedEvent` → step completes (with actionType, outputs, duration, source references)
   - `ToolStartedEvent` / `ToolCompletedEvent` → tool lifecycle within a step
3. WHEN the response is streaming THEN the state SHALL accumulate text from `AssistantResponseChunkEvent.output`
4. WHEN the agent pauses THEN the state SHALL reflect the paused status and any confirmation requests
5. WHEN a new conversation starts THEN the state SHALL generate a fresh `sessionId` UUID
6. WHEN an existing conversation is loaded THEN the state SHALL restore the `sessionId` for continuity

---

### Requirement 9: Remove Custom Backend Dependencies

**User Story:** As a developer, I want the custom backend server removed from the critical path, so that the app runs entirely against Domo APIs.

#### Acceptance Criteria

1. WHEN the app runs THEN it SHALL NOT require the Express.js backend server for core chat functionality
2. WHEN API calls are made THEN they SHALL go directly to the Domo instance URL (authenticated via Domo session/token)
3. WHEN the custom backend is removed THEN the following frontend services SHALL be replaced or removed:
   - `src/services/context.ts` → replaced by Domo Agent streaming service
   - `src/services/mcp.ts` → replaced by Domo Toolkit API calls (if MCP management UI is retained)
   - `src/services/conversation.ts` → replaced by session-based state + optional local persistence
4. WHEN Domo proxy auth is needed THEN the system SHALL use the existing Domo app auth mechanism (Domo custom app token or `X-DOMO-Developer-Token`)

---

### Requirement 10: User-in-the-Loop Support

**User Story:** As a user, I want the agent to ask for my confirmation before taking certain actions, so that I maintain control over sensitive operations.

#### Acceptance Criteria

1. WHEN `RequestConfirmationEvent` is received during streaming THEN the system SHALL display the confirmation prompt to the user
2. WHEN the user approves THEN the system SHALL call `/api/ai/v1/agents/{agentId}/resume/streaming` with the appropriate `AgentResumeRequest` (sessionId, sourceRequestId, response)
3. WHEN the user rejects THEN the system SHALL send a rejection response via the resume endpoint or cancel the stream
4. WHEN `ToolPausedEvent` is received THEN the system SHALL indicate the specific tool that is paused and why
5. WHEN resuming THEN the stream SHALL continue with the same event types as the original execution

---

## Non-Functional Requirements

### Code Architecture and Modularity

- **Service Abstraction**: All Domo API interactions SHALL be encapsulated in typed service classes (not raw fetch calls scattered in components)
- **Event Handling**: SSE event parsing SHALL be centralized in a single event handler/dispatcher, not distributed across components
- **Type Safety**: All Domo API request/response types SHALL be defined as TypeScript interfaces matching the OpenAPI spec
- **Single Responsibility**: Separate concerns: API client → event parser → state management → UI rendering

### Performance

- SSE connections SHALL stream events in real-time with no buffering delay
- The frontend SHALL render text chunks incrementally as `AssistantResponseChunkEvent`s arrive
- Session IDs SHALL be persisted client-side to avoid unnecessary new session creation
- Heartbeat events SHALL be handled without triggering UI re-renders

### Security

- API authentication SHALL use the Domo app's native auth mechanism (custom app token propagation)
- The `X-DOMO-Embedded-Security` header SHALL be supported for embedded app contexts
- No API keys or tokens SHALL be exposed in client-side code or logs

### Reliability

- IF the SSE stream disconnects THEN the system SHALL surface the error and allow the user to retry
- IF an event type is unrecognized THEN the system SHALL log it and continue (forward-compatible)
- IF the agent returns an error event THEN the system SHALL display the error message and allow recovery

### Observability

- All Domo API calls SHALL be logged in development mode with request/response details
- SSE event types SHALL be logged for debugging stream behavior
- `AIDurationEvent` data SHALL be captured for performance monitoring
