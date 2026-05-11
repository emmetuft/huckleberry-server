# Architecture Diagrams

Current scope: **3-month MVP.** Schema and services are deliberately minimal; tenancy, multi-instance, multi-IdP, and audit log are deferred until we have a shared understanding of post-MVP requirements.

| File | What it covers | State |
|---|---|---|
| `system-overview.md` | High-level: Huckleberry UI/BFF, AWS services, Mako (Domo agent platform), third-party | MVP |
| `aurora-integration.md` | Aurora connectivity, IAM database auth, full schema (identity + linkage + Category B), ER, ops decisions | MVP |
| `auth-architecture.md` | NestJS module shape, all Aurora tables, what was retired | MVP |
| `auth-providers.md` | BFF auth module shape — HuckleberryAuthGuard + DomoAuthBroker + token store | MVP |
| `oauth-flow.md` | Three sequences: huckleberry sign-in (Layer A), Domo linkage (Layer B), per-request token broker | **Today** |
| `memory-architecture.md` | Intent engine + multi-tier memory in Mako (mako-intent-engine, memory-app, episodic+semantic+procedural) | MVP |

> **Model note:** Huckleberry is a standalone SaaS at `huckleberry.com`. Two cooperating auth layers:
> - **Layer A — Huckleberry identity.** Magic-link sign-in (no passwords), HttpOnly session cookie, Redis-backed sessions. Users are seeded via vetted operator tooling at customer onboarding time — no self-service signup. We own this end-to-end.
> - **Layer B — Domo OAuth linkage.** The BFF is a **confidential OAuth 2.1 client** to each customer's Gatekeeper. Server-side code exchange via `client_secret` in AWS Secrets Manager. Refresh tokens KMS-encrypted in Aurora.
>
> The brief "frontend as OAuth public client" design from the embedded-in-Domo era is retired. The earlier confidential-client design (server-side `/auth/domo/*`, encrypted token storage) is restored.

> **Auth provider note:** Gatekeeper OAuth 2.1 is the Domo OAuth server. All endpoint paths are `/oauth2/*`; signing is ES256; access tokens carry `typ: at+jwt`; refresh tokens are single-use with rotation + cascade revoke. See `../authentication.md` for design rationale and `~/dev/gatekeeper/docs/` for the canonical contract.

Read order: `../authentication.md` for the design rationale → `system-overview.md` for the box-and-wire view → `auth-architecture.md` for service/table detail → `oauth-flow.md` for the request sequence → `auth-providers.md` for the BFF module shape → `aurora-integration.md` for AWS-side auth → `memory-architecture.md` for the memory layer.
