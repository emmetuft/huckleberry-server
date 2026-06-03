# System Overview — Huckleberry, AWS, Domo

High-level view of the deployed system. Auth-flow specifics live in the auth diagrams; this one is about the boxes and the wires between them.

## 1. System Context

```mermaid
graph LR
    USER[End User<br/>Browser]

    HB["Huckleberry<br/>huckleberry.ai · AWS<br/>UI + BFF + Aurora + Redis"]

    DOMO["Domo Platform<br/>customer.domo.com<br/>Gatekeeper · Mako · Instance APIs"]

    MCP["External MCP Servers<br/>per-user registrations"]

    USER -->|static SPA| HB
    USER -->|session cookie + API| HB
    HB -->|PKCE OAuth — no client_secret| DOMO
    HB -->|Bearer JWT — agents · AI · users · data| DOMO
    HB -->|tool calls| MCP

    classDef user fill:#fef3c7,stroke:#d97706,color:#000
    classDef huckleberry fill:#dbeafe,stroke:#2563eb,color:#000
    classDef domo fill:#fce7f3,stroke:#db2777,color:#000
    classDef external fill:#dcfce7,stroke:#16a34a,color:#000

    class USER user
    class HB huckleberry
    class DOMO domo
    class MCP external
```

## 2. Huckleberry Account (AWS)

```mermaid
graph TB
    USER[End User / Browser]

    subgraph EDGE["Edge"]
        CF["CloudFront + ACM<br/>TLS · static CDN"]
        WAF["AWS WAF<br/>rate limit · bot rules"]
        ALB[Application Load Balancer]
    end

    subgraph COMPUTE["Compute"]
        UI["UI · S3 + CloudFront<br/>huckleberry.ai"]
        BFF["BFF · NestJS on EKS Fargate<br/>HPA-scaled"]
    end

    subgraph DATA["Data"]
        AURORA[("Aurora MySQL<br/>users · tokens · personas · MCP")]
        REDIS[("ElastiCache Redis<br/>sessions · token cache · OAuth state")]
    end

    subgraph PLATFORM["Platform"]
        SM["Secrets Manager<br/>signing key · Aurora master · SES creds"]
        KMS["KMS<br/>envelope encryption"]
        SES["SES — magic-link email"]
        CW["CloudWatch + OTel<br/>logs · metrics · traces"]
        ECR["ECR — container images"]
    end

    USER --> CF & WAF
    CF --> UI
    WAF --> ALB --> BFF
    BFF --> AURORA & REDIS & SM & SES & CW
    AURORA & SM --> KMS

    classDef user fill:#fef3c7,stroke:#d97706,color:#000
    classDef huckleberry fill:#dbeafe,stroke:#2563eb,color:#000

    class USER user
    class CF,WAF,ALB,UI,BFF,AURORA,REDIS,SM,KMS,SES,CW,ECR huckleberry
```

## 3. Domo Platform (BFF-facing surfaces)

Only the surfaces the BFF calls directly. Mako's internal composition (intent engine, memory capture/retrieval pipeline, MongoDB) is documented in [`memory-architecture.md`](memory-architecture.md).

Gatekeeper sits in front of all Domo APIs — the BFF exchanges access tokens with it, and the resulting Bearer JWTs are what authenticate calls to Mako and Instance APIs.

```mermaid
graph TB
    BFF["Huckleberry BFF"]

    subgraph DOMO["Domo Platform · customer.domo.com"]
        GK["Gatekeeper OAuth 2.1 · auth-code + PKCE · ES256 · per-instance registration · issues + validates Bearer JWTs for all Domo APIs"]
        AGENT["Mako · Agent Runtime<br/>execute · resume · streaming · CRUD"]
        AI["Mako · AI Services<br/>generate · summarize · text-to-SQL"]
        INST["Instance APIs<br/>/api/content · /api/identity · /api/data"]
        PUB["⚠ Public API<br/>api.domo.com"]
    end

    BFF -->|platform requests via access token| GK
    GK -->|Bearer JWT| AGENT & AI & INST
    BFF -.avoid — use Instance APIs.-> PUB

    classDef huckleberry fill:#dbeafe,stroke:#2563eb,color:#000
    classDef domo fill:#fce7f3,stroke:#db2777,color:#000
    classDef warn fill:#fee2e2,stroke:#dc2626,color:#000

    class BFF huckleberry
    class GK,AGENT,AI,INST domo
    class PUB warn
```

## Where each piece lives

### Huckleberry (AWS)

| Component        | AWS service                         | Purpose                                                                                                                                    |
| ---------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| UI               | S3 + CloudFront                     | Static SPA served from `huckleberry.ai`. Talks to the BFF only — never directly to Gatekeeper or Domo.                                    |
| BFF              | EKS (Fargate profile) + ALB Ingress | NestJS API. Owns huckleberry identity (Layer A) + Domo OAuth broker (Layer B). HorizontalPodAutoscaler scales pods on CPU + request rate. |
| Primary DB       | Aurora MySQL                        | `users`, Domo linkage, `domo_oauth_tokens` (KMS-encrypted), Category B app data. All app rows `customer_id`-scoped.                       |
| Cache + sessions | ElastiCache Redis                   | Huckleberry server-side sessions (revocable), Domo access-token cache, PKCE `link_init` state.                                            |
| AWS auth         | Task IAM Role                       | Aurora IAM auth, Secrets Manager reads, KMS decrypt, SES send. No long-lived AWS secrets in the container.                                |
| Secrets          | Secrets Manager + KMS               | Session JWT signing key, Aurora master (break-glass), SES SMTP credentials. KMS for envelope-encrypted OAuth refresh tokens at rest.      |
| Email            | AWS SES                             | Magic-link sign-in emails.                                                                                                                 |
| Edge             | CloudFront + WAF + ACM              | TLS termination, DDoS / rate-limit, bot rules.                                                                                             |
| Observability    | CloudWatch + OpenTelemetry          | Logs, metrics, traces.                                                                                                                     |
| Image registry   | ECR                                 | BFF container images.                                                                                                                      |

### Domo Platform

| Surface                                            | Auth                                                                                                                                          | What Huckleberry uses it for                                                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gatekeeper `/oauth2/{authorize,token,jwks,revoke}` | auth code + PKCE (OAuth 2.1, ES256). **Public PKCE client** — `token_endpoint_auth_method=none`, no client_secret. Per-instance registration. | BFF runs the OAuth flow server-side when a user links an instance; refreshes Domo tokens on demand and verifies them against the instance's JWKS. |
| Mako: `/api/ai/v1/agents/*`                        | Bearer JWT (Gatekeeper)                                                                                                                       | Agent execute, resume, streaming, CRUD.                                                                                                          |
| Mako: `/api/ai/v1/memory/*`                        | Bearer JWT, Bedrock customer-scoped                                                                                                           | Memory admin (read what's remembered, right-to-forget).                                                                                          |
| Mako: `/api/ai/v1/text/*`                          | Bearer JWT                                                                                                                                    | Text generation, summarization, text-to-SQL.                                                                                                     |
| Mako: `/api/ai/v1/toolkits/*`                      | Bearer JWT                                                                                                                                    | Toolkit CRUD.                                                                                                                                    |
| Mako: `/api/recall/v1/*`                           | Bearer JWT                                                                                                                                    | Knowledge graph nodes (read path).                                                                                                               |
| `/api/content/v3/*`, `/api/identity/v1/*`          | Bearer JWT                                                                                                                                    | Users, groups, current user.                                                                                                                     |
| `/api/data/v3/*`                                   | Bearer JWT                                                                                                                                    | Datasources, schemas, queries.                                                                                                                   |
| ~~`api.domo.com` (public)~~                        | `client_credentials` OAuth                                                                                                                    | **Avoid** — does not expose AI/memory/recall endpoints. Use Instance APIs instead.                                                               |

### Third-party

| Component            | Owned by | Purpose                                                |
| -------------------- | -------- | ------------------------------------------------------ |
| External MCP servers | per-user | Tool execution surfaces registered through MCP service |

## Things this diagram is deliberately not showing

- The internal NestJS module breakdown — see `auth-architecture.md`
- Auth sequence details — see `oauth-flow.md`
- OAuth client shape — see `auth-providers.md`
- Mako's internal composition and the memory pipeline — see `memory-architecture.md`
- CI/CD pipeline (GitHub Actions → ECR → EKS rollout) — out of scope for system context
