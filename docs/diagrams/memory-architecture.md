# Memory Architecture — MVP

Multi-tier memory built into Mako (Domo agent platform), **centered on the intent engine**. Huckleberry consumes implicitly through the agent runtime; explicit access only for admin UI and eval. Designed so any Domo agent — not just Huckleberry — can use it.

**At MVP:** MongoDB-backed, no vector search yet, retrieval is keyword + structured queries. Schema is graph-migration-friendly so post-MVP unlocks (vector search, graph backend) are mechanical.

## The Intent Engine

The **intent engine** is the runtime layer that manages context and intent for the agent. Everything else in this architecture serves it. Per the memory design doc: *"This layer is primarily focused on context and intent engineering"* — it sits on top of message history and session events, decides what's relevant for the current turn, calls into durable memory when needed, and shapes the prompt the LLM finally sees.

Concretely the intent engine is responsible for:

1. **Intent classification** — what is the user actually asking? (`entity_lookup | relationship | metric_query | tool_use | other`)
2. **Working memory management** — message-history compaction, pruning, evidence offload, active goal/plan/checklist tracking
3. **Memory orchestration** — deciding when and what to retrieve from durable memory tiers (episodic, semantic, procedural)
4. **Context assembly** — merging retrieved memory + working state + agent system prompt into the final LLM context

It is the **brain** that turns raw input into focused, high-signal context. Memory tiers (episodic, semantic, procedural) are the *substrate*; the intent engine is the *operator*.

In Mako, the intent engine ships as the **`mako-intent-engine`** shared module. Working memory is one capability of the intent engine, not the whole thing. Used by `ai-assistant-app`; productized for any future Mako agent.

## Tiers

| Tier | What it holds | Where it lives at MVP | Module |
|---|---|---|---|
| **Intent engine (runtime / working memory)** | Active task state, intent classification, working memory compaction, memory-call orchestration, context assembly | In-process per execution (Redis for evidence offload) | `mako-intent-engine` (shared library) |
| **Episodic memory** | Chronological session events — what the agent did and saw | MongoDB session-history collections (existing) + `memory_episodic_refs` | `memory-app` + existing `ai-app` |
| **Semantic memory** | Entities and facts learned from interactions | MongoDB (`memory_entities`, `memory_facts`) | `memory-app` |
| **Procedural memory** | Learned execution patterns | Stub at MVP; full integration with Domo Recall is post-MVP | `memory-app` (interface only) |

## Component diagram

```mermaid
graph LR
    subgraph "Huckleberry"
        UI[Huckleberry UI<br/>chat · ontology · memory admin]
        BFF[Huckleberry BFF<br/>NestJS]
    end

    subgraph "Mako — Domo Agent Platform"
        EXECUTOR[ai-assistant-app<br/>AssistantExecutorService<br/>execute · resume · streaming]

        subgraph "mako-intent-engine (shared)"
            INTENT_CLASS[Intent Classification<br/>entity_lookup · relationship<br/>metric_query · tool_use]
            WORKING[Working Memory<br/>compaction · pruning<br/>evidence offload]
            ORCH[Memory Orchestration<br/>when/what to retrieve]
            ASSEMBLY[Context Assembly<br/>merge retrieved + working<br/>+ system into LLM prompt]
        end

        subgraph "memory-app (new)"
            CAPTURE[Capture<br/>Kafka subscriber on<br/>SessionEventService]
            EXTRACT[Extraction<br/>end-of-turn LLM call<br/>entities + facts]
            RETRIEVE[Retrieval<br/>entity anchor + structured<br/>query + rerank + temporal]
            ADMIN[Admin API<br/>inspect · forget]
        end

        AI_SVC[AI Services<br/>generate · summarize · embed]
        BEDROCK[Bedrock<br/>customer enforcement]
        KAFKA[[Kafka<br/>SessionEvent topics]]
        REDIS[(Redis<br/>working memory<br/>evidence cache)]
    end

    subgraph "Storage"
        MONGO[(MongoDB<br/>memory_entities<br/>memory_facts<br/>memory_episodic_refs<br/>session_history)]
        GRAPH[(Domo-hosted Graph<br/>future: semantic memory<br/>migration target)]
    end

    UI --> BFF
    BFF --> EXECUTOR
    BFF --> ADMIN

    EXECUTOR --> INTENT_CLASS
    INTENT_CLASS --> ORCH
    ORCH --> WORKING
    ORCH -.retrieval call<br/>200ms timeout.-> RETRIEVE
    ORCH --> ASSEMBLY
    ASSEMBLY --> EXECUTOR
    EXECUTOR --> AI_SVC
    EXECUTOR --> KAFKA

    KAFKA --> CAPTURE
    CAPTURE --> EXTRACT
    EXTRACT --> AI_SVC
    EXTRACT --> MONGO
    CAPTURE --> MONGO
    RETRIEVE --> MONGO
    ADMIN --> MONGO

    WORKING --> REDIS

    BEDROCK -.customer scope.-> CAPTURE
    BEDROCK -.customer scope.-> RETRIEVE
    BEDROCK -.customer scope.-> ADMIN

    MONGO -.post-MVP migration.-> GRAPH
```

## Data flow — capture and extraction

```mermaid
sequenceDiagram
    autonumber
    participant U as User (via Huckleberry UI)
    participant BFF as Huckleberry BFF
    participant EX as ai-assistant-app<br/>Executor
    participant K as Kafka<br/>SessionEvent topic
    participant CAP as memory-app<br/>Capture
    participant XT as memory-app<br/>Extract
    participant AI as Mako AI Services
    participant DB as MongoDB

    U->>BFF: chat message
    BFF->>EX: POST /agents/{id}/execute/streaming
    EX->>EX: assemble context
    EX->>K: emit ASSISTANT_REQUEST,<br/>ACTION_STARTED, etc.
    EX-->>BFF: SSE stream (response chunks)
    BFF-->>U: stream

    Note over EX,K: at end of turn
    EX->>K: emit ASSISTANT_RESPONSE_END

    K->>CAP: subscriber receives events
    CAP->>DB: write memory_episodic_refs<br/>(customerId, userId, sessionId, eventIds)

    CAP->>XT: trigger extraction (async)
    XT->>AI: extract entities + facts<br/>(LLM call, structured output)
    AI-->>XT: { entities: [...], facts: [...] }
    XT->>DB: dedup + upsert memory_entities<br/>(keyword match, customerId-scoped)
    XT->>DB: upsert memory_facts<br/>with provenance + derivedFrom refs
```

## Data flow — retrieval injection

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant BFF as Huckleberry BFF
    participant EX as ai-assistant-app<br/>Executor
    participant RE as memory-app<br/>Retrieve
    participant DB as MongoDB
    participant LLM as LLM provider

    U->>BFF: chat message (next turn)
    BFF->>EX: POST /agents/{id}/execute/streaming

    Note over EX,RE: memory injection hook
    EX->>RE: recall(customerId, userId, sessionId, queryText)<br/>200ms budget

    alt within budget
        RE->>DB: extract query entities (LLM)
        RE->>DB: resolve query entities (text index)
        RE->>DB: find facts where subjectEntityId/objectEntityId matches
        RE->>DB: text-index supplement on fact.text
        RE->>RE: dedupe + temporal filter + rerank
        DB-->>RE: top-K facts with provenance
        RE-->>EX: memory results
        EX->>EX: merge into system context
    else timeout or error
        RE-->>EX: empty (memory non-blocking)
        Note right of EX: agent proceeds<br/>without memory
    end

    EX->>LLM: invoke with system + memory + user
    LLM-->>EX: response
    EX-->>BFF: SSE stream
    BFF-->>U: response
```

## Provenance — every memory write carries

```ts
type Provenance = {
  source: 'agent' | 'session' | 'document' | 'human' | 'system';
  customerId: string;          // MANDATORY — Bedrock enforcement
  userId: string;
  sessionId?: string;
  scope: 'user' | 'instance' | 'org';
  confidence: number;          // 0..1
  createdAt: string;           // ISO 8601
  validStartingAt?: string;    // bi-temporal — defaults to createdAt at MVP
  invalidAt?: string | null;
  expiredAt?: string | null;
  derivedFromCount?: number;   // populated post-MVP for community ranking
  derivedFrom?: string[];      // MongoDB session event IDs
};
```

Every entity, fact, and episodic reference carries this metadata. Schema accommodates post-MVP features (decay, supersession, community detection) without migration.

## Mongo schema (graph-migration-friendly)

| Collection | Purpose | Equivalent in graph (post-MVP) |
|---|---|---|
| `memory_entities` | One doc per entity. `{_id, customerId, name, type, summary, embedding (null at MVP), provenance}` | `(:Entity)` nodes |
| `memory_facts` | One doc per atomic fact. `{_id, customerId, subjectEntityId, predicate, objectEntityId?, text, embedding (null at MVP), confidence, provenance}` | Typed relationships with properties |
| `memory_episodic_refs` | References from facts/entities to originating session events. `{_id, customerId, memoryId, sessionEventId, sessionId, createdAt}` | `[:DERIVED_FROM]` edges |

**Indexes (MVP):**
- Compound `(customerId, name)` and `(customerId, type)` on `memory_entities`
- Compound `(customerId, subjectEntityId)`, `(customerId, objectEntityId)` on `memory_facts`
- Mongo text indexes on `memory_entities.name + summary` and `memory_facts.text` for keyword retrieval
- Compound `(customerId, sessionId)` on `memory_episodic_refs`
- **No vector indexes** at MVP. Embedding fields reserved on documents but unpopulated.

## What's IN at MVP

- **Intent engine (`mako-intent-engine`)** — shared module; intent classification (basic), working memory compaction/pruning, memory-call orchestration, context assembly
- Episodic capture from agent turns → MongoDB
- Entity + fact extraction (B+: entities + facts, preferences as stretch)
- Retrieval call from intent engine before LLM invocation (200ms budget; non-blocking)
- Bedrock customer-scoped enforcement on every operation
- Right-to-forget admin API: cascades `memory_entities`, `memory_facts`, `memory_episodic_refs`
- Provenance metadata fully wired

## What's OUT (post-MVP, planned with shape ready)

- **Vector search / semantic similarity** — adds when Mako has Atlas Vector Search or migrates to a graph with native vector index. Embedding fields already reserved.
- **Graph migration** — Mongo docs map mechanically to graph nodes/edges. Schema designed for it.
- **Procedural memory** — interface stub at MVP; full Domo Recall integration post-MVP.
- **Promotion mechanics** — candidate → canonical with validation pipeline. MVP writes go canonical directly.
- **Decay strategy / `expired_at` workflows** — fields exist, not exercised.
- **Community detection (Leiden), hierarchical summarization** — post-MVP organizational layer.
- **Document/file ingestion** — separate ingestion path with chunk hierarchy.
- **Reflection step** in extraction — single-pass extraction at MVP.
- **Truth resolution / supersession** of competing assertions — fields modeled, resolver deferred.
- **Bi-temporal queries** — `validStartingAt` defaults to `createdAt` at MVP.

## Cross-cutting properties

- **Memory never blocks the agent.** 200ms timeout on retrieval; failure proceeds without memory. Logged + alerted.
- **Customer isolation is non-negotiable.** Every operation carries `customerId`; Bedrock enforces. Cross-customer leakage = MVP fail.
- **Productized for Domo platform.** Both `mako-intent-engine` and `memory-app` are shared infrastructure; any Mako agent can consume them, not just Huckleberry.
- **One hook in agent runtime.** `AssistantExecutorService` invokes the intent engine; the intent engine orchestrates everything else (working memory, retrieval, context assembly). The executor sees one entry point, not four.

## Open questions to resolve before May 1

1. Intent engine module name (`mako-intent-engine` proposed; confirm naming convention with platform team)
2. Right-to-forget granularity — `(customerId, userId)` or `(customerId, userId, sessionId)`?
3. Extraction LLM choice — which Mako AI service / model? Cost + latency budget?
4. Mongo cluster — confirm existing Mongo cluster Mako uses can host new memory collections, or needs dedicated provisioning
5. Procedural memory stub interface shape (so post-MVP Recall integration is clean)
6. Preferences (stretch goal) trigger — what signal during development tells us to layer them in?

## References

- Multi-layered memory design doc (internal — working / episodic / semantic / procedural / promotion / lifecycle)
- 3-month MVP roadmap: `../huckleberry-3-month-mvp-plan.md`
- Mako repo: `~/dev/mako`
