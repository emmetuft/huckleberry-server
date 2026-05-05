# Huckleberry MVP Roadmap

3-month plan to MVP. Six engineers across three repos: **Mako** (Domo agent platform), **huckleberry-server** (BFF), **huckleberry-ui** (frontend). Date-anchored milestones, parallel workstreams each sprint.

---

## TLDR

| Sprint | Dates | What ships |
|---|---|---|
| **1** | May 1 – May 15 | Foundation: graph in dev, intent engine + memory module skeletons, schema locked, ontology page editable, AWS architecture cemented |
| **2** | May 18 – Jun 18 | Intent engine + memory capture session events and extract entities + facts; AI helps build ontologies; metadata layer connects graph to real Domo data |
| **3** | Jun 22 – Jul 17 | Intent engine orchestrates memory recall; agents demonstrate cross-session continuity; memory admin UI live; Gatekeeper auth complete; right-to-forget working |
| **4** | Jul 20 – Jul 31 | MVP demo-ready; eval shows memory uplift; intent engine + memory observability live; go/no-go on next phase |

**Headline outcome at Jul 31:** an agent that **understands intent** and **remembers** — what it learned about your data, your entities, and your prior conversations. Across sessions, scoped to your customer, with full auditability and one-click forget. Built on a productized **intent engine** plus multi-tier memory in Mako, usable by any Domo agent (not just Huckleberry).

---

## What we're building

Four parallel tracks, all owned by the same team:

### Track 1 — Intent Engine (Mako)
The runtime brain. New shared module `mako-intent-engine`. Classifies user intent, manages working memory (compaction, pruning, evidence offload), orchestrates calls into the memory tiers, assembles the final LLM context. Productized so any Domo agent can use it — not Huckleberry-specific. **This is where context and intent engineering happens.**

### Track 2 — Memory (Mako)
The substrate the intent engine operates over. New module `memory-app` plus extensions to existing Mako components. Episodic capture (session events to MongoDB), entity + fact extraction, retrieval API, admin API. MongoDB-backed at MVP; schema designed for graph migration post-MVP. Procedural memory stub for post-MVP Recall integration.

### Track 3 — Huckleberry App (UI + BFF)
The Huckleberry frontend gets ontology editing, AI-assisted entity suggestions, a memory admin surface, and hardened authentication. The BFF (huckleberry-server) gets a memory client and eval framework integration.

### Track 4 — Production Architecture
AWS environment cemented, Gatekeeper OAuth integration, instance creation/spawn architecture, observability dashboards. Cross-cuts Mako and Huckleberry.

---

## May 1 — May 15

**Theme: Foundation. Graph live, schema locked, ontology editable.**

### Intent Engine (Mako)
- New `mako-intent-engine` shared module skeleton — productized for cross-agent reuse
- Module contracts defined: intent classification interface, working memory interface, memory-orchestration interface, context-assembly interface
- Integration point in `AssistantExecutorService` identified — single hook before LLM call
- Working memory data shapes (active goals, plans, message-history compaction state) drafted

### Memory (Mako)
- New `memory-app` module skeleton in Mako; Kafka listener stub against `SessionEventService`
- Provenance schema locked — every memory write carries customer, user, session, source, timestamps, scope, confidence
- MongoDB collections + indexes provisioned (`memory_entities`, `memory_facts`, `memory_episodic_refs`)
- Mongo cluster confirmed (existing or new — see open decisions)

### Huckleberry App
- Ontology page write operations live: create nodes, create relationships, edge creation UI in the 3D graph
- BFF: `MemoryClientService` stub against drafted admin API contract
- BFF: CI pipeline pushing container images to ECR

### Production Architecture
- Huckleberry AWS environment + storage configuration cemented
- Authentication architecture (Gatekeeper) underway
- Instance creation/spawn architecture underway
- Domo-hosted graph accessible in dev (within first week)

---

## May 18 — Jun 18

**Theme: Intent engine integrated. Memory captures and extracts. AI starts helping build the ontology.**

### Intent Engine (Mako)
- `mako-intent-engine` integrated into `AssistantExecutorService` — single hook before LLM call
- Working memory active during execution: message-history compaction, pruning, active-goal tracking
- Evidence offload to Redis cache wired
- Basic intent classification online (lightweight prompt-based: `entity_lookup | relationship | metric_query | tool_use | other`)
- Context assembly composing system prompt + working memory + (placeholder for) retrieved memory

### Memory (Mako)
- Episodic capture path live: every agent turn writes session events with full provenance
- End-of-turn extraction live: LLM identifies entities and facts, deduplicates, writes to Mongo
- Customer-scoped writes enforced via Bedrock at every operation

### Huckleberry App
- AI-assisted ontology UI: "suggest entities from this dataset" → review → accept/edit/reject → persist
- BFF: admin client connected to Mako staging endpoints
- BFF: Domo metadata ingestion (datasets, users, ownership, lineage where available)

### Production Architecture
- Gatekeeper OAuth client wired and tested in non-prod
- Instance spawn flow exercised end-to-end

---

## Jun 22 — Jul 17

**Theme: Intent engine orchestrates. Agents recall. Auth complete. Forget works.**

### Intent Engine (Mako)
- Memory orchestration live — intent engine decides when to call memory retrieval based on classified intent
- Retrieved memory merged into context assembly before LLM invocation
- 200ms latency budget on memory calls; non-blocking failure path validated (memory enhances, never blocks)
- Intent classification telemetry online (per-turn classifications logged for tuning)

### Memory (Mako)
- Retrieval pipeline live: entity anchor + structured fact query + text-index supplement + rerank + temporal filter
- Right-to-forget API: deletes a user's memories with cascade across all collections
- Bedrock customer isolation validated end-to-end on writes and reads

### Huckleberry App
- Memory admin UI live: "what does the agent remember about [entity]?" inspector, episodic event log per session, right-to-forget button
- Auth complete: Gatekeeper login, session refresh, logout, AuthGuard fully implemented
- BFF: right-to-forget admin flow wired through to Mako

### Production Architecture
- Bedrock customer enforcement validated across the stack
- Security review checklist passed

---

## Jul 20 — Jul 31

**Theme: MVP readiness. Measure, demo, decide.**

### Intent Engine (Mako)
- Hardening, observability dashboards (intent classification accuracy, working-memory compaction effectiveness, context-assembly latency)
- Intent-classification confusion matrix from telemetry — feeds post-MVP tuning roadmap
- Operational runbook for the intent engine module

### Memory (Mako)
- Hardening, observability dashboards (capture rate, extraction success, retrieval latency p95, right-to-forget cascade timing)
- Operational runbook for memory-app

### Huckleberry App
- Eval harness runs `memory_uplift` dimension — measures whether memory actually improves agent answers vs. memory-off baseline
- Chat UI hardened: error states, retry, timeout handling, polish
- End-to-end demo flow tested
- Documentation: how to use, how to extend

### Cross-cutting
- Stakeholder demo
- Go/no-go decision on continued ontology + memory investment based on signal
- Post-MVP roadmap drafted (vector search, graph migration, more memory tiers)

---

## Engineer allocation (6 engineers)

| Track | Workstream | Engineers | Repo(s) |
|---|---|---|---|
| Track 1 | **Intent Engine** (`mako-intent-engine` shared library — classification, working memory, orchestration, context assembly). Flex resource after wk 6. | 1 | mako |
| Track 2 | **Memory** (`memory-app` — capture, extraction, retrieval, admin API + the single hook into `AssistantExecutorService`) | 2 | mako |
| Track 3a | **Huckleberry UI** — ontology editing, AI-assisted ontology, memory admin, auth, chat polish | 1 | huckleberry-ui |
| Track 3b | **Huckleberry BFF** — memory client, eval framework, BFF auth integration | 1 | huckleberry-server |
| Track 4 | **Production Architecture** — AWS, Gatekeeper, instance spawn, observability | 1 | cross-repo |

---

## Risks

| Risk | Mitigation |
|---|---|
| Gatekeeper OAuth not live by Jun 22 | Dev-token path preserved; auth UI work proceeds without dependency; flip when ready |
| LLM extraction quality (entities, facts) | Iterate prompts during Sprint 2; eval-driven tuning in Sprint 4 |
| Intent classification accuracy is basic at MVP (lightweight prompt-based classifier) | Acceptable for MVP — classifier mistakes fall back to default routing; sophistication is a post-MVP investment |
| UI engineer workload (ontology + memory + auth + AI-assisted) | Dedicated lane; chat already functional; auth gets protected time |
| Cross-repo coordination overhead | Daily 15-min sync across three repo leads during Sprint 1 to lock contracts |
| No vector search at MVP — memory only matches on entity names, not paraphrased queries | Eval fixtures target named-entity continuity. Vector search is Phase A post-MVP. |

---

## What's intentionally out of MVP

These come post-MVP, planned in detail after Jul 31 with real signal in hand:

- **Vector search / semantic similarity** — needs Atlas Vector Search or graph migration first
- **Graph as memory storage** — Mongo at MVP; mechanical migration later
- **Procedural memory** — agent-learned execution patterns (the "how" not the "what")
- **Document/file ingestion** — uploaded docs as memory sources
- **Promotion mechanics** — candidate → canonical memory validation
- **Decay, supersession, community detection (Leiden), reflection** — full memory architecture in the design doc
- **Sophisticated intent classification + multi-step planning** — MVP ships a lightweight classifier; rich intent reasoning (multi-step plans, intent revision mid-turn) is post-MVP

---

## Open decisions before May 1

1. Intent engine module naming convention (`mako-intent-engine` proposed)
2. Right-to-forget granularity: `(customer, user)` or `(customer, user, session)`?
3. Which AI service / model handles extraction (cost + latency budget)
4. Eval harness location: BFF, Mako, or shared
5. Procedural memory stub interface shape
6. Mongo cluster: existing capacity or dedicated provisioning?
7. UI: memory admin as own page or section in Ontology page?
8. UI: AI-assisted ontology UX — modal, drawer, or inline panel?

---

## Reference docs

- Memory architecture design: the multi-layered memory doc shared internally (intent engine + working / episodic / semantic / procedural)
- Memory architecture diagram: `docs/diagrams/memory-architecture.md` — intent engine, tiers, capture/retrieval flows, schema
- AWS infrastructure: `docs/diagrams/system-overview.md`, `docs/diagrams/aurora-integration.md`
- Auth architecture: `docs/diagrams/auth-architecture.md`, `docs/diagrams/oauth-flow.md`, `docs/diagrams/auth-providers.md` (Gatekeeper OAuth 2.1 — replacing the older Heimdall)
- Plan working file: `/Users/jon.tiritilli/.claude/plans/here-s-a-doc-on-wise-dusk.md`
