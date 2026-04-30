# Architecture Diagrams

Current scope: **MVP for internal use.** Schema and services are deliberately minimal; tenancy, multi-instance, multi-IdP, and audit log are deferred until we have a shared understanding of post-MVP requirements.

| File | What it covers | State |
|---|---|---|
| `system-overview.md` | High-level: Huckleberry, AWS services, Domo surfaces, third-party | MVP |
| `aurora-integration.md` | Aurora connectivity, surrounding AWS, ER, ops decisions | MVP |
| `auth-architecture.md` | NestJS services, Aurora tables, provider seam, deferred items | MVP |
| `auth-providers.md` | `DomoAuthProvider` interface, swap mechanics | MVP |
| `domoweb-auth-flow.md` | `/api/domoweb/auth/login` sequence — what we build first | **Today** |
| `oauth-flow-future.md` | Authorization-code + PKCE sequence | Future (blocked on Domo) |

Read order: `system-overview.md` for the box-and-wire view → `auth-architecture.md` for service/table detail → `auth-providers.md` for the swap seam → pick a flow doc for the provider you care about.
