# Huckleberry — 60-Day Outcome Map

**Question this answers:** what can a 2–3 person skunkworks credibly achieve in 60 days, and which outcomes are actually reachable versus seductive-but-not.

**Window:** ~60 days ≈ 8.5 weeks ≈ 4 two-week sprints, starting from current state (≈ Aug–Sep 2026; the archived 3-month plan's May–Jul window has elapsed).

> **This map was revised after inspecting Mako.** The memory substrate is not hypothetical — a working hackathon-grade implementation exists on branch, and its author (Jeremy Rodgers) is on this team. The 60 days is therefore about *proving and hardening* memory, not *building* it. That changes almost everything below.

---

## Start state — what is and isn't already paid for

Verified against this repo (huckleberry-server), the archived plan, and the Mako branches `team-delorean/hackathon` + `users/jeremy.rodgers/long-term-memory`:

| Area | State | Implication for 60 days |
|---|---|---|
| Auth (Gatekeeper OAuth, magic-link, sessions) | **Shipped** | Don't re-spend. Login/scoping is a given. |
| Security hardening (KMS envelope crypto, CORS, helmet, SSRF, log redaction) | **Shipped** (7 phases) | Don't re-spend. Hard security debt is paid — but see tenancy gate below. |
| BFF product surfaces (agents, personas, toolkits, datasources, connectors, mcp, graph) | **Built as thin proxies** | Plumbing exists. No memory client yet — the BFF side is still greenfield. |
| **Mako memory substrate** (capture → gated extract → graph store → entity-anchor + semantic + rerank recall → per-agent injection) | **EXISTS, hackathon-grade** (~2,335 LOC, branch-only) | The core build is largely done. Wired into the agent path at `ToolPlanningStep.enrichWithRecalledMemory`. |
| **Eval / beat-baseline instrument** | **ABSENT** | The one thing the go/no-go depends on. Still the #1 gap. |
| **Latency budget on recall** | **ABSENT** | Recall is on the hot path, multiple LLM calls, unbounded `.join()`. Production blocker. |
| **Tenant isolation in memory layer** | **THIN** (delegated to graph security context; no `customerId`) | A *risk*, not a feature — could reintroduce the cross-tenant leakage the 7 security phases just killed. |
| **Right-to-forget** | **Primitives only**, no user-facing delete | Compliance gap; small build. |
| **Merge state** | **Branch-only, two diverged branches, nothing on master; core paths untested** | Must be stabilized before anything can be evaluated. |

**The consequence — the reframe:** build-risk on the memory substrate has **collapsed**. The 60 days is no longer "can we build memory." It's *"does the graph-grounded memory that already exists actually beat a naive baseline, and can we harden it (latency, tenancy, forget) and surface it in Huckleberry."* The engineering surface didn't shrink — it **shifted** from build-memory to **stabilize + prove + harden + integrate + surface**.

---

## The bet — settled, and mostly built

The bet is **memory** ("I told it last week; this week it remembered"). That was a live choice when the vision offered two paths — memory vs. *synthesis* ("it connected three sources overnight and told me why"). Synthesis is what the vignettes *lead with* and it's the flashier demo, but it has no clean go/no-go and may already be Mako's job. Memory won because it has a falsifiable eval and the substrate was already underway. That's now confirmed: the substrate exists. The choice is closed; the rest of this doc executes it.

The scarce resource for 2–3 people across Mako + BFF + UI is **integration and proof**, not building the engine. Jeremy owning the Mako line means the substrate is a *team deliverable*, not an external dependency — the other 1–2 people take eval + BFF client + the insight surface. Keep the slice depth-one everywhere: one canonical branch, one eval, one BFF client, one surface.

---

## The north star this serves — proactive, context-aware insight

Memory is the **means**, not the end. The goal is proactive insight: *the context makes the AI aware of what matters to this user, and it prompts them to dig into those things — helping them ask the right questions at the right time.* This is the synthesis half of the vision (the set-aside bet from earlier), and it's what gives the memory substrate a reason to exist. A passive "it remembered X" demo is unconvincing; *"because it knows you track dispute-aging and sees the cohort aging now, it's surfacing that for you to look at"* is the vignette.

**Prove vs. show — the load-bearing distinction.** Insight quality is fuzzy and would contaminate a clean go/no-go if it gated it. So (per your call):
- **Memory is PROVEN.** The hard gate stays exactly the pre-registered bar (≥15pp / −30% / ≥70% vs naive baseline). If memory-grounded recall beats baseline, insights built on it have a *validated foundation* — a valid proxy.
- **Insight is SHOWN.** Built as the payoff surface, demoed live, assessed by the skeptic — plus a **lightweight backtest** as *non-gating* secondary evidence (see kill criterion). Prove the substrate, show the payoff, explicit about which is which.

**"Right time" = ranking + scarcity, not push.** The achievable form of "at the right time" is **session-start prioritization** — when the user opens Huckleberry, the surface *ranks* what's worth their attention and stays *scarce* (a few items, not a dump). Zero background jobs. Truly proactive *push* (arrives without the user present, the overnight brief, scarce notifications) is the expensive part — out (see cut line).

**Framed as questions.** Surfacing *questions* ("the dispute cohort is aging toward its window — want to look at the reallocation options?") rather than asserted conclusions is safety-aligned with the vignettes' boundary (*Huckleberry surfaces and explains; the expert decides*) and degrades gracefully — a decent question is useful even when imperfect, whereas a confidently wrong asserted "insight" is damaging.

**Honest cost — this is a new entry point, not the existing recall.** Today's Mako memory is *query-triggered enrichment* (`enrichWithRecalledMemory` prepends recalled memory to a user turn). Insights need the opposite trigger: "user just opened the app — given everything I know, what should I surface?" There is no turn to enrich. That's a **new generate-the-brief capability** (memory + data signals + a salience/ranking prompt), and the `AIInsight` enum + `AIInsightEvent` carrier already in Mako are only the *transport*, not that brain. Cost it as "a generation capability **and** a surface," and note it lands on the 1–2 non-Jeremy people already carrying eval + BFF client + UI. **This is the single most likely thing to break the frame** — see the cut line for where it stops.

---

## Two preconditions that gate everything — resolve in week 1

Neither is optional. Both can independently sink the plan, and both are cheap to check first.

### Precondition A — Stabilize to a runnable, evaluable build
The eval can't point at anything until there is a **canonical branch running against a graph instance + LLM tier**. Today it's branch-only, two diverged branches, nothing on master, core paths (store, retrieval) untested. **The new critical path is not "run eval" — it's "pick/merge a canonical branch and get it running where you can measure it."** Budget **1–2 of the 8.5 weeks** for this before an eval number exists. "The substrate exists" is not "the substrate is ready." Jeremy leads this; it's week-1 work.

### Precondition B — Verify tenant isolation actually holds
The memory layer carries `userId` + `scope` but **no `customerId`** — cross-customer isolation is delegated to the graph service's security context, with a single `graphId` per app instance. If that assumption doesn't hold, enabling memory reintroduces exactly the cross-tenant leakage the BFF's 7 security phases just eliminated (IDOR, cross-tenant token disclosure). **This can kill the demo tiers regardless of how good the eval number is.** Verify it independently and early, in parallel with stabilization. If it doesn't hold, hardening it is in-scope and comes *before* any customer-facing surface.

---

## Outcome tiers

Each tier states the **capability** (what someone sees), the **engineering** (what backs it), and the **decision** (what it unlocks). Tiers are promoted only modestly from the pre-Mako version — build-risk collapsed on the *substrate*, but a full plate of stabilize/harden/integrate/surface work replaced it.

### FLOOR — the commit. *Achievable, and the go/no-go now lands earlier.*
**Capability:** the existing memory, running on a canonical build, demonstrably recalls across sessions — and we have a **real number** for whether it beats a naive baseline, plus proof that one customer's memories can't leak to another.

**Engineering:**
- Precondition A done: canonical branch merged, running in an evaluable env.
- Precondition B done: tenant isolation verified (or hardened).
- **Eval harness** measuring the *real* bar (see kill criterion): graph-grounded memory vs. naive vector-RAG-over-metadata, on accuracy + hallucination + tool-grounding. Not memory-on-vs-off (that's a cheap ablation, not the gate).

**Decision unlocked:** go/no-go on the memory bet, backed by a number against the pre-registered bar and a live demo. Because the substrate already runs, **this can land ~week 4–5, not day 45** — the single biggest gain from the substrate existing.

### TARGET — the goal. *Achievable, because build-risk on the engine is gone — but the insight surface is where the risk moved.*
**Capability:** Floor + memory is production-safe + the **payoff surface**: on session-start, Huckleberry surfaces a *ranked, scarce* set of context-grounded **questions worth asking now** ("you track dispute-aging; the cohort is aging toward its window — want the reallocation options?"), each showing *why it surfaced* (its memory/data provenance) and each an open door to dig in. A working "forget." Latency-bounded recall.

**Engineering:** Floor +
- **latency budget** (200ms timeout on retrieval, recall-nothing on deadline miss — currently absent)
- **right-to-forget** endpoint (primitives exist; expose + cascade)
- **BFF memory client** (greenfield)
- **the insight surface = two parts, not one:** (a) a **generate-the-brief capability** — a new session-start entry point that assembles memory + available data signals and runs a salience/ranking prompt to produce a few scarce, provenance-tagged questions (reusing the `AI_INSIGHT` event transport); (b) the **UI** that renders and ranks them. This is the scope watch-item.

**Decision unlocked:** justify continued investment; pick which tier to deepen post-60 (push/background delivery? metric-driven insights once `queryData` works? the metric-grounding companion?). This is the outcome that earns a real budget conversation.

### STRETCH — the reach. *Now plausible, not fantasy — but don't commit to it.*
**Capability:** a second capability wired to memory — the **metric-grounding companion** (recalled metric shows its source via graph edges), or a second surface, or one trust-ladder atom (suggest → approve → undo).

**Engineering:** a second surface/contract, or extending the memory graph with metric/dataset/owner nodes (see below). Reachable only if Preconditions land fast and the eval clears early. Every hour here competes with hardening the number and the demo.

**Honest call:** plan for Target. Treat Stretch as a bonus from clearing the go/no-go early, not a commitment.

---

## What is NOT achievable in 60 days — the cut line

Each of these is in the vignettes and each is *out*, with the reason:

| Vignette element | Why it's out of 60 days |
|---|---|
| **Proactive *push* insight delivery** (the overnight brief, scarce notifications, "buzzes once at 6:58") | Requires a scheduler + job substrate + never-blast timing judgment. The *pull* form (session-start ranking) is Target; *push* is out. This is the boundary "insights" must not quietly cross. |
| **A proven salience-quality bar** ("the insights are measurably the *right* ones") | Insight quality is *shown* + backtested as non-gating evidence, not *proven* to a pre-registered bar. Making salience a hard gate is a fuzzier eval than 60 days supports — and would contaminate the clean memory gate. |
| **Metric-driven insights** ("dispute volume up 18%, here's why") | Gated on the metric layer, which is thin and blocked today (`queryData` broken). 60-day insights are context/memory-driven questions, not metric-anomaly explanations. |
| **Background processes / overnight pre-connection** | Requires a scheduler + job substrate + *trustworthy* recall first. You can't automate what the eval hasn't validated. |
| **Cross-user insights** ("Rob Chen's team has the same root cause") | Needs multi-user memory reach + a relevance engine + governance on who-can-see-what. A quarter of work. |
| **The trust ladder at scale** (promote → auto-act → reversible feed) | The *atom* (one suggest/approve/undo) is Stretch. The *system* is post-MVP. |
| **Internet access / live external data** | New integration surface + safety review. Proves nothing about memory. |
| **The six-bucket surface set** (Todos, Explanations, Results, Aha, Decisions) | Each bucket is a feature. Build **one** surface (Target), not the taxonomy. |
| **Governance beyond customer-scoping** (per-agent permissions) | Customer isolation + forget is Floor/Target. Fine-grained governance is a program. |
| **Cleanup jobs** (decay, supersession, community detection) | Post-MVP. Premature before there's memory volume to manage. (Note: resolution/dedup already *exists* in the hackathon build.) |
| **Procedural memory, multi-step intent planning, the intent engine** | Post-MVP. The hackathon build is retrieval-augmented memory, not a planning engine. |
| **Deep lineage** (column-level, transform-logic, cross-system) | The graph-hard part of metric grounding. Shallow lineage may be in reach (below); deep is not. |

**The trap:** all of these demo beautifully in a slide. Naming them keeps the 60-day scope honest — especially now that "the substrate exists" invites over-promising.

---

## The companion — metric grounding (and how the graph changes it)

Memory recalls **numbers**. Without grounding for what a metric means, where it comes from, and that it means different things to different teams, memory recalls figures it can't verify — the trust floor under **any answer that cites a number**, which is most of the vignettes' punch (*"a metric that can't explain itself is just a number"*). It's a companion to memory, not a competitor.

**The Mako finding reframes "full graph is out."** Memory *already* persists in the graph device (Neo4j/Synapse) with vector indexes and node labels `MEMORY` / `MEMORY_ENTITY` and `DERIVED_FROM` provenance edges. So consuming the graph for grounding is not a new graph — it's **extending the graph memory already uses** with `METRIC` / `DATASET` / `OWNER` nodes and edges. "Full graph out" means *building the business ontology*, not *adding a few metric nodes to the store that's already running*.

| Layer | What it is | 60-day verdict |
|---|---|---|
| **Definition** (metric catalog) | What a metric means; defined differently per team/department | **Achievable.** A registry (table or graph nodes); `dataset:meta:read` / `content:meta:read` scopes cover seeding from Domo metadata. |
| **Provenance** (shallow lineage) | Metric → source dataset(s) → owner, 1–2 hops | **Conditional — see verify-item.** Edges in the existing graph *if* Domo exposes lineage via API; graph-hard to compute otherwise. |
| **Decomposition** (drill-down) | Trend + segmented breakdown ("96% for this pattern vs 81% overall") | **Blocked today.** `datasources.service.ts` `queryData` carries a `// This doesn't work, need another endpoint` comment. Segmented query must work first. |
| **Movement attribution** ("why is it moving") | "The gain traces to the Q1 intake-form change" | **Out** — synthesis + history. |
| **Thresholds / alerts** | Proactive metric watching | **Out** — background processes. |

**Verify-item (week 1):** does Domo expose dataset/dataflow lineage via API, at what granularity, under what scope? No lineage-specific scope is in the granted set, so this is an assumption. If yes → lineage is edges in the existing graph. If no → it drifts toward graph-hard and drops out.

**How it fits:** grounding is **Stretch**, not Floor — the go/no-go rides on memory beating baseline, and grounding is downstream of that clearing. If it clears early, metric nodes in the existing memory graph are the natural first extension.

---

## The single kill criterion — beat the *naive baseline*, not "nothing"

The pre-registration is already on record (skunkworks charter): **the bar is naive baseline retrieval — a RAG setup using only Domo APIs + vector search over metadata text, no graph, no ontology.** The hackathon build *is* the graph-grounded system that bar was written to judge.

> By the **go/no-go checkpoint (target ~week 5, after Preconditions land)**, the graph-grounded memory must beat naive-vector-RAG-over-metadata by **≥15pp accuracy AND −30% hallucination AND ≥70% tool-grounded rate** — *and* a live demo must survive a skeptic. If not: adjust scope, pivot (drop graph where vector RAG ties), or stop.

Two consequences:
- **Memory-on vs. memory-off is a cheap ablation, not the gate.** A system this elaborate (graph, anchoring, semantic + RRF fusion, rerank) can easily beat *nothing* while failing to beat a dumb baseline — the exact "ontology theatre" trap the charter warns against. The gate is beat-naive-baseline.
- **This is a bigger eval build than an accuracy fixture.** Measuring hallucination and tool-grounding — not just answer accuracy — is real work. It's the first thing to build (Precondition A gates it), because the instrument that can kill the project ships before the polish.

**Fixture credibility.** The go/no-go rests on the fixture set, so a skeptic's first move is "you built fixtures for the cases memory is good at." Have someone who is *not* on the recall path author them, make them representative of real Hucklebank threads (include adversarial cases where memory *shouldn't* help), and freeze the set before iterating.

**The insight backtest — secondary, non-gating.** To show (not prove) the payoff is real, run a lightweight backtest: take historical Hucklebank-style moments where something mattered, feed the system the context from *before* that moment, and check whether it surfaces the right question. This is more falsifiable than live human rating and it does **not** gate the go/no-go — it's evidence alongside the skeptic demo. **Verify-item (week 1):** does usable historical data exist to backtest against? If not, the payoff is assessed by live demo only, and that's an accepted, stated limitation — not a reason to slip the gate.

---

## Recommendation

**Aim for TARGET. Commit to FLOOR. Prove memory; show insights. Treat push/background and a proven-salience bar as out.**

The one outcome to pursue:

> *A canonical, tenant-safe build of the existing graph-grounded memory that beats the naive baseline on the pre-registered bar (≥15pp / −30% / ≥70%) — and, riding on it, a session-start Huckleberry surface that ranks a scarce set of context-grounded questions worth asking now, each showing why it surfaced. Memory proven by the gate; insights shown live and backtested as non-gating evidence.*

Sequencing for 2–3 engineers (Jeremy on Mako; 1–2 on eval + BFF + insight surface):

| Weeks | Focus | Gate |
|---|---|---|
| 1–2 | **Precondition A**: merge to canonical branch, run in evaluable env. **Precondition B**: verify tenant isolation. Build the eval harness (accuracy + hallucination + tool-grounding vs naive baseline). Author + freeze fixtures. **Verify backtest data exists.** BFF client + surface stubs. | Canonical build running; tenancy answered; eval runs vs baseline; backtest-data question answered. |
| 3–4 | Eval emits real numbers against the bar. Iterate recall where it's losing. Latency budget (200ms timeout, recall-nothing on miss). | First real beat-baseline numbers on CI. |
| 5 | **Go/no-go checkpoint.** Numbers vs. the pre-registered bar + skeptic demo. Adjust / pivot / stop. | Decision made on evidence, not vibe. |
| 6–8 | If go: right-to-forget endpoint, BFF memory client, and **the payoff surface** — the generate-the-brief entry point + ranked/scarce UI + insight backtest. Harden, demo rehearsal. | Live demo: tenant-safe, latency-bounded recall powering a scarce, provenance-tagged question feed. |

Build the eval harness first — it's the instrument that can kill the project, and because the substrate already runs, it can produce a real answer weeks earlier than a from-scratch plan could. That earlier, cheaper go/no-go is the whole dividend of the hackathon work.

> **A note on scope, said plainly.** This is the fourth expansion of the goal (memory → +metric grounding → +insights). Insights-as-*shown*-payoff fits — it rides on the substrate and the pull-form needs no background jobs. It is also the **last expansion that fits 60 days.** The next things the vision invites — *push* delivery, the overnight brief, a proven-salience bar, metric-anomaly explanations — each break the frame, and they're named in the cut line so "insights" doesn't quietly grow into them. The generate-the-brief step is the one to watch: it lands on the two people already carrying eval + BFF + UI, so if week-1/2 preconditions run long, the insight surface is the first thing to shorten — not the eval.
