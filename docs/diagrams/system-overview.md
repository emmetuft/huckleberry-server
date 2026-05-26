# System Overview — Huckleberry, AWS, Domo

High-level view of the deployed system. Shows where Huckleberry runs in AWS, which AWS services back it, and which Domo surfaces it talks to. Auth-flow specifics live in the auth diagrams; this one is about the boxes and the wires between them.

## Diagram

```mermaid
graph LR
    USER[End User<br/>Browser]

    subgraph AWS["AWS — Huckleberry Account"]
        direction TB
        CF["Edge · CloudFront + ACM<br/>TLS, static asset CDN"]
        WAF["Edge · AWS WAF<br/>rate limit + bot rules"]
        ALB["Edge · Application Load Balancer"]
        UI_HOST["Compute · Huckleberry UI<br/>S3 + CloudFront<br/>huckleberry.ai"]
        BFF["Compute · Huckleberry BFF<br/>NestJS on EKS (Fargate profile)<br/>HPA-scaled behind ALB Ingress"]
        AURORA[("Data · Aurora MySQL<br/>users · linked_domo_instances<br/>domo_oauth_tokens — KMS-encrypted<br/>personas · mcp_servers — customer_id scoped")]
        REDIS[("Data · ElastiCache Redis<br/>huckleberry sessions<br/>Domo access-token cache<br/>OAuth link_init state")]
        TASK_ROLE["Platform · Task IAM Role<br/>rds-db:connect · kms:Decrypt<br/>secretsmanager:GetSecretValue · ses:SendEmail"]
        SM["Platform · Secrets Manager<br/>session signing key<br/>Aurora master — break-glass<br/>SES SMTP creds"]
        KMS["Platform · KMS<br/>envelope encryption<br/>for stored OAuth refresh tokens"]
        SES["Platform · AWS SES<br/>magic-link sign-in emails"]
        CW["Platform · CloudWatch + OTel<br/>logs · metrics · traces"]
        ECR["Platform · ECR<br/>container images"]
    end

    subgraph DOMO["Domo Platform"]
        direction TB
        GATEKEEPER["Gatekeeper OAuth 2.1<br/>customer.domo.com/oauth2/*<br/>auth-code + PKCE · ES256<br/>refresh-token rotation"]
        MAKO_AGENT["Mako · Agent Runtime<br/>ai-assistant-app<br/>execute · resume · streaming"]
        INTENT_ENGINE["Mako · mako-intent-engine<br/>intent classification<br/>working memory<br/>context assembly"]
        MEMORY_APP["Mako · memory-app<br/>capture · extract · retrieve<br/>customer-scoped"]
        MAKO_AI["Mako · AI Services<br/>generate · summarize · embed"]
        MAKO_GRAPH["Mako · Graph Device<br/>Domo-hosted graph"]
        MAKO_DB[("Mako · MongoDB<br/>session history +<br/>memory entities/facts")]
        DOMO_INST["Instance APIs<br/>/api/content/v3/users<br/>/api/identity/v1/users<br/>/api/data/v3/datasources"]
        DOMO_PUB["Public API<br/>api.domo.com<br/>client_credentials only"]
    end

    subgraph EXT["Third-Party"]
        MCP_EXT["External MCP Servers<br/>per-user registrations"]
    end

    USER --> CF
    CF --> UI_HOST
    USER --> WAF
    WAF --> ALB
    USER -->|huckleberry session cookie| WAF
    ALB --> BFF

    BFF -.IAM auth token.-> TASK_ROLE
    BFF --> AURORA
    BFF --> REDIS
    BFF --> SM
    BFF --> SES
    AURORA --> KMS
    SM --> KMS
    BFF --> CW
    BFF -.pulls image.-> ECR

    BFF -->|PKCE code exchange + refresh<br/>server-side, no client_secret| GATEKEEPER
    BFF -->|forwards Bearer for active link| MAKO_AGENT
    MAKO_AGENT --> INTENT_ENGINE
    INTENT_ENGINE --> MEMORY_APP
    MAKO_AGENT --> MAKO_AI
    MEMORY_APP --> MAKO_DB
    MEMORY_APP --> MAKO_GRAPH
    MAKO_AGENT --> MAKO_DB
    BFF --> DOMO_INST
    BFF -.future or limited.-> DOMO_PUB
    BFF --> MCP_EXT

    classDef edge fill:#fef3c7,stroke:#d97706
    classDef compute fill:#dbeafe,stroke:#2563eb
    classDef data fill:#dcfce7,stroke:#16a34a
    classDef platform fill:#f3e8ff,stroke:#9333ea
    classDef mako fill:#fce7f3,stroke:#db2777
    class CF,WAF,ALB edge
    class UI_HOST,BFF compute
    class AURORA,REDIS data
    class TASK_ROLE,SM,KMS,SES,CW,ECR platform
    class MAKO_AGENT,INTENT_ENGINE,MEMORY_APP,MAKO_AI,MAKO_GRAPH,MAKO_DB mako
```

## Where each piece lives

### Huckleberry (AWS)

| Component        | AWS service                | Purpose                                                                                                                                   |
| ---------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| UI               | S3 + CloudFront            | Static SPA served from `huckleberry.ai`. Talks to the BFF only — never directly to Gatekeeper or Domo                                     |
| BFF              | EKS (Fargate profile) + ALB Ingress | NestJS API. Owns huckleberry identity (Layer A) + Domo OAuth broker (Layer B). HorizontalPodAutoscaler scales pods on CPU + request rate |
| Primary DB       | Aurora MySQL               | `users`, Domo linkage, `domo_oauth_tokens` (KMS-encrypted), Category B app data. All app rows `customer_id`-scoped                        |
| Cache + sessions | ElastiCache Redis          | Huckleberry server-side sessions (revocable), Domo access-token cache, PKCE `link_init` state                                             |
| AWS auth         | Task IAM Role              | Aurora IAM auth, Secrets Manager reads, KMS decrypt, SES send. No long-lived AWS secrets in the container                                 |
| Secrets          | Secrets Manager + KMS      | Session JWT signing key, Aurora master (break-glass), SES SMTP credentials. KMS for envelope-encrypted OAuth refresh tokens at rest. (No Gatekeeper `client_secret` — BFF is a public PKCE client.) |
| Email            | AWS SES                    | Magic-link sign-in emails                                                                                                                 |
| Edge             | CloudFront + WAF + ACM     | TLS termination, DDoS / rate-limit, bot rules                                                                                             |
| Observability    | CloudWatch + OpenTelemetry | Logs, metrics, traces                                                                                                                     |
| Image registry   | ECR                        | BFF container images                                                                                                                      |

### Domo Platform

| Surface                                            | Auth                                                                                    | What Huckleberry uses it for                                                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gatekeeper `/oauth2/{authorize,token,jwks,revoke}` | auth code + PKCE (OAuth 2.1, ES256). **Public PKCE client** — `token_endpoint_auth_method=none`, no client_secret. Per-instance registration | BFF runs the OAuth flow server-side when a user links an instance; refreshes Domo tokens on demand and verifies them against the instance's JWKS |
| Mako: `/api/ai/v1/agents/*`                        | Bearer JWT (Gatekeeper)                                                                 | Agent execute, resume, streaming, CRUD                                                                                                           |
| Mako: `/api/ai/v1/memory/*`                        | Bearer JWT, Bedrock customer-scoped                                                     | Memory admin (read what's remembered, right-to-forget)                                                                                           |
| Mako: `/api/ai/v1/text/*`                          | Bearer JWT                                                                              | Text generation, summarization, text-to-SQL                                                                                                      |
| Mako: `/api/ai/v1/toolkits/*`                      | Bearer JWT                                                                              | Toolkit CRUD                                                                                                                                     |
| Mako: `/api/recall/v1/*`                           | Bearer JWT                                                                              | Knowledge graph nodes (read path)                                                                                                                |
| `/api/content/v3/*`, `/api/identity/v1/*`          | Bearer JWT                                                                              | Users, groups, current user                                                                                                                      |
| `/api/data/v3/*`                                   | Bearer JWT                                                                              | Datasources, schemas, queries                                                                                                                    |
| `api.domo.com` (public)                            | `client_credentials` OAuth                                                              | Limited — does not expose AI/memory/recall endpoints                                                                                             |

### Third-party

| Component            | Owned by | Purpose                                                |
| -------------------- | -------- | ------------------------------------------------------ |
| External MCP servers | per-user | Tool execution surfaces registered through MCP service |

## Things this diagram is deliberately not showing

- The internal NestJS module breakdown — see `auth-architecture.md`
- Auth sequence details — see `oauth-flow.md`
- OAuth client shape — see `auth-providers.md`
- Memory architecture detail (capture, extraction, retrieval pipeline) — see `memory-architecture.md`
- CI/CD pipeline (GitHub Actions → ECR → EKS rollout) — out of scope for system context
- Mako's internal module composition (ai-app, ai-assistant-app, recall-app, synapse-app, etc.)
