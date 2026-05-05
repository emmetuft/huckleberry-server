# Architecture Diagrams

Current scope: **3-month MVP.** Schema and services are deliberately minimal; tenancy, multi-instance, multi-IdP, and audit log are deferred until we have a shared understanding of post-MVP requirements.

| File | What it covers | State |
|---|---|---|
| `system-overview.md` | High-level: Huckleberry UI/BFF, AWS services, Mako (Domo agent platform), third-party | MVP |
| `aurora-integration.md` | Aurora connectivity, surrounding AWS, ER, ops decisions | MVP |
| `auth-architecture.md` | NestJS services, Aurora tables, deferred items | MVP |
| `auth-providers.md` | Gatekeeper OAuth 2.1 client shape (single provider) | MVP |
| `oauth-flow.md` | Authorization-code + PKCE sequence via Gatekeeper, scopes, registration | **Today** |
| `memory-architecture.md` | Intent engine + multi-tier memory in Mako (mako-intent-engine, memory-app, episodic+semantic+procedural) | MVP |

> **Auth provider note:** Gatekeeper OAuth 2.1 is the current internal OAuth provider, replacing the older Heimdall (now retired). Earlier drafts of these diagrams referenced Heimdall — content has been migrated to Gatekeeper.

Read order: `system-overview.md` for the box-and-wire view → `auth-architecture.md` for service/table detail → `memory-architecture.md` for the memory layer → `auth-providers.md` for OAuth client shape → `oauth-flow.md` for the request sequence.
