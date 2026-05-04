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

    subgraph "Domo — Per Customer Instance"
        DOMO_AUTH["Auth Surface<br/>domoweb — /api/domoweb/auth/login<br/>oauth — /oauth/authorize + /oauth/token (future)"]
        DOMO_INST[Instance APIs<br/>/api/ai/v1/agents<br/>/api/ai/v1/sessions<br/>/api/ai/v1/text<br/>/api/ai/v1/toolkits<br/>/api/recall/v1/nodes<br/>/api/content/v3/users<br/>/api/identity/v1/users<br/>/api/data/v3/datasources]
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

    BFF --> DOMO_AUTH
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

### Domo (per-instance, customer-owned)

| Surface | Auth | What Huckleberry uses it for |
|---|---|---|
| `/api/domoweb/auth/login` | plaintext creds (today) | User authentication — domoweb provider |
| `/oauth/authorize` + `/oauth/token` (instance) | auth code + PKCE (future) | User authentication — oauth provider |
| `/api/ai/v1/*` | session / dev token | Agents, sessions, text generation, toolkits |
| `/api/recall/v1/*` | session / dev token | Knowledge graph nodes |
| `/api/content/v3/*`, `/api/identity/v1/*` | session / dev token | Users, groups, current user |
| `/api/data/v3/*` | session / dev token | Datasources, schemas, queries |
| `api.domo.com` (public) | `client_credentials` OAuth | Limited — does not expose AI/recall endpoints |

### Third-party

| Component | Owned by | Purpose |
|---|---|---|
| External MCP servers | per-user | Tool execution surfaces registered through MCP service |

## Things this diagram is deliberately not showing

- The internal NestJS module breakdown — see `auth-architecture.md`
- Auth sequence details — see `domoweb-auth-flow.md` and `oauth-flow-future.md`
- The provider seam — see `auth-providers.md`
- CI/CD pipeline (GitHub Actions → ECR → ECS) — out of scope for system context
- Neo4j / mem0 — referenced in config but not currently wired into the running system
