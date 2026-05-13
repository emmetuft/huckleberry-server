# Architecture Diagrams

Current scope: **3-month MVP.** Schema and services are deliberately minimal; tenancy beyond `customer_id`-scoped rows, multi-instance per user, multi-IdP, and audit log are out of scope.

| File | What it covers |
|---|---|
| `system-overview.md` | High-level: Huckleberry UI/BFF, AWS services, Mako (Domo agent platform), third-party |
| `aurora-integration.md` | Aurora connectivity, IAM database auth, full schema (identity + linkage + Category B), ER, ops decisions |
| `auth-architecture.md` | NestJS module shape and Aurora tables |
| `auth-providers.md` | BFF auth module shape — HuckleberryAuthGuard + DomoAuthBroker + token store |
| `oauth-flow.md` | Three sequences: huckleberry sign-in (Layer A), Domo linkage (Layer B), per-request token broker |
| `memory-architecture.md` | Intent engine + multi-tier memory in Mako (mako-intent-engine, memory-app, episodic+semantic+procedural) |

> **Model note:** Huckleberry is a standalone SaaS at `huckleberry.com`. Two cooperating auth layers:
> - **Layer A — Huckleberry identity.** Magic-link sign-in (no passwords), HttpOnly session cookie, Redis-backed sessions. Self-service signup auto-provisions a Domo instance for new users.
> - **Layer B — Domo OAuth linkage.** The BFF is a **confidential OAuth 2.1 client** to each customer's Gatekeeper. Server-side `client_credentials` grant at runtime; the per-customer credential is provisioned at signup and stored KMS-encrypted in Aurora.

> **Auth provider note:** Gatekeeper OAuth 2.1 is the Domo OAuth server. Endpoint paths are `/oauth2/*`; signing is ES256; access tokens carry `typ: at+jwt`; refresh tokens are single-use with rotation + cascade revoke. See `../authentication.md` for design rationale and `~/dev/gatekeeper/docs/` for the canonical contract.

Read order: `../authentication.md` for the design rationale → `system-overview.md` for the box-and-wire view → `auth-architecture.md` for service/table detail → `oauth-flow.md` for the request sequence → `auth-providers.md` for the BFF module shape → `aurora-integration.md` for AWS-side auth → `memory-architecture.md` for the memory layer.
