# System Overview — Huckleberry, AWS, Domo

High-level view of the deployed system. Shows where Huckleberry runs in AWS, which AWS services back it, and which Domo surfaces it talks to. Auth-flow specifics live in the auth diagrams; this one is about the boxes and the wires between them.

## Diagram

```mermaid
graph LR
    USER[End User<br/>Browser]

    subgraph "AWS — Huckleberry Account"
        subgraph "Edge"
            CF[CloudFront + ACM<br/>TLS, static asset CDN]
            ALB[Application Load Balancer]
            WAF[AWS WAF<br/>rate limit + bot rules]
        end

        subgraph "Compute"
            UI_HOST[Huckleberry UI<br/>S3 + CloudFront<br/>or ECS]
            BFF[Huckleberry BFF<br/>NestJS on ECS Fargate<br/>autoscaled behind ALB]
        end

        subgraph "Data"
            AURORA[(Aurora MySQL<br/>users · personas<br/>domo_sessions · sessions<br/>agents_meta · mcp_servers)]
            REDIS[(ElastiCache Redis<br/>sessions + token cache)]
        end

        subgraph "Platform"
            SM[Secrets Manager<br/>DB creds · JWT key<br/>token-encryption key<br/>per-instance OAuth secrets]
            KMS[KMS<br/>envelope encryption]
            CW[CloudWatch + OTel<br/>logs · metrics · traces]
            ECR[ECR<br/>container images]
        end
    end

    subgraph "Domo Platform"
        GATEKEEPER[Gatekeeper OAuth 2.1<br/>/oauth/authorize + /oauth/token<br/>auth-code + PKCE]

        subgraph "Mako — Agent Platform"
            MAKO_AGENT[Agent Runtime<br/>ai-assistant-app<br/>execute · resume · streaming]
            INTENT_ENGINE[mako-intent-engine<br/>intent classification<br/>working memory<br/>context assembly]
            MEMORY_APP[memory-app<br/>capture · extract · retrieve<br/>customer-scoped]
            MAKO_AI[AI Services<br/>generate · summarize · embed]
            MAKO_GRAPH[Graph Device<br/>Domo-hosted graph]
            MAKO_DB[(MongoDB<br/>session history +<br/>memory entities/facts)]
        end

        DOMO_INST[Instance APIs<br/>/api/content/v3/users<br/>/api/identity/v1/users<br/>/api/data/v3/datasources]
        DOMO_PUB[Public API<br/>api.domo.com<br/>client_credentials only]
    end

    subgraph "Third-Party"
        MCP_EXT[External MCP Servers<br/>per-user registrations]
    end

    USER --> CF
    CF --> UI_HOST
    USER --> WAF
    WAF --> ALB
    ALB --> BFF

    BFF --> AURORA
    BFF --> REDIS
    BFF --> SM
    SM --> KMS
    AURORA --> KMS
    BFF --> CW
    BFF -.pulls image.-> ECR

    BFF --> GATEKEEPER
    BFF --> MAKO_AGENT
    MAKO_AGENT --> INTENT_ENGINE
    INTENT_ENGINE --> MEMORY_APP
    MAKO_AGENT --> MAKO_AI
    MEMORY_APP --> MAKO_DB
    MEMORY_APP --> MAKO_GRAPH
    MAKO_AGENT --> MAKO_DB
    BFF --> DOMO_INST
    BFF -.future or limited.-> DOMO_PUB
    BFF --> MCP_EXT
```

## Where each piece lives

### Huckleberry (AWS)

| Component | AWS service | Purpose |
|---|---|---|
| UI | S3 + CloudFront (or ECS if SSR) | Static frontend, edge-cached |
| BFF | ECS Fargate behind ALB | NestJS API, scales horizontally |
| Primary DB | Aurora MySQL | Users, tenants, personas, tokens, sessions |
| Cache | ElastiCache Redis | Hot session lookups, Domo token cache |
| Secrets | Secrets Manager + KMS | OAuth client secrets, JWT signing key, token encryption key |
| Edge | CloudFront + WAF + ACM | TLS termination, DDoS / rate-limit, bot rules |
| Observability | CloudWatch + OpenTelemetry | Logs, metrics, traces |
| Image registry | ECR | BFF container images |

### Domo Platform

| Surface | Auth | What Huckleberry uses it for |
|---|---|---|
| Gatekeeper `/oauth/authorize` + `/oauth/token` | auth code + PKCE (OAuth 2.1) | User authentication; Bearer JWT for downstream calls |
| Mako: `/api/ai/v1/agents/*` | Bearer JWT (Gatekeeper) | Agent execute, resume, streaming, CRUD |
| Mako: `/api/ai/v1/memory/*` | Bearer JWT, Bedrock customer-scoped | Memory admin (read what's remembered, right-to-forget) |
| Mako: `/api/ai/v1/text/*` | Bearer JWT | Text generation, summarization, text-to-SQL |
| Mako: `/api/ai/v1/toolkits/*` | Bearer JWT | Toolkit CRUD |
| Mako: `/api/recall/v1/*` | Bearer JWT | Knowledge graph nodes (read path) |
| `/api/content/v3/*`, `/api/identity/v1/*` | Bearer JWT | Users, groups, current user |
| `/api/data/v3/*` | Bearer JWT | Datasources, schemas, queries |
| `api.domo.com` (public) | `client_credentials` OAuth | Limited — does not expose AI/memory/recall endpoints |

### Third-party

| Component | Owned by | Purpose |
|---|---|---|
| External MCP servers | per-user | Tool execution surfaces registered through MCP service |

## Things this diagram is deliberately not showing

- The internal NestJS module breakdown — see `auth-architecture.md`
- Auth sequence details — see `oauth-flow.md`
- OAuth client shape — see `auth-providers.md`
- Memory architecture detail (capture, extraction, retrieval pipeline) — see `memory-architecture.md`
- CI/CD pipeline (GitHub Actions → ECR → ECS) — out of scope for system context
- Mako's internal module composition (ai-app, ai-assistant-app, recall-app, synapse-app, etc.)
