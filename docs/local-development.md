# Local development

Single source of truth for getting huckleberry-server running on your laptop. README has the architectural overview; this doc has the laptop-level mechanics.

## Prerequisites

Assumed already on your machine: **Node ≥ 20**, **npm** (ships with Node — used only to enable Corepack), and **Homebrew**.

What this repo needs on top:

- **pnpm 10**, via Corepack — don't `npm i -g pnpm`; Corepack avoids version drift. The repo pins the major via `packageManager` so `pnpm --version` always matches what the lockfile expects.
- **Podman 5+** for the local MySQL container. Docker Desktop's license excludes most orgs; Podman is FOSS and `podman compose` is a drop-in for `docker compose`.

```bash
corepack enable                       # pnpm via Corepack
brew install podman
podman machine init && podman machine start
```

## One-time setup

```bash
git clone git@github-publicent:domo-development/huckleberry-server.git
cd huckleberry-server
corepack pnpm install
cp .env.example .env   # then edit — see ".env values you need to set" below
```

The frontend lives in a separate repo, `~/dev/huckleberry`. Same setup there: `pnpm install`, copy `.env.example`, follow its README.

## `.env` values you need to set

`.env.example` is split into a **REQUIRED** section at the top and an **OPTIONAL** section below. Copy + fill in the required block; optional defaults work for local dev.

**Required** (six vars):

| Var                        | What it is                                                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_SIGNING_KEY`      | HS256 secret signing the `hb_session` cookie. `openssl rand -hex 32`. When left empty, the BFF generates a random ephemeral key at boot — sessions will not survive server restarts. Set explicitly if you need persistent sessions across restarts.                                |
| `DOMO_OAUTH_CLIENT_ID`     | DCR-registered PKCE client on the target Domo instance. Register once via Postman (`2a. DCR — register public client (PKCE)`); save the `client_id` here and the `registration_access_token` separately for future RFC 7592 edits. |
| `GATEKEEPER_ISSUERS`       | Comma-separated list of issuer URLs the BFF will accept tokens from. Byte-for-byte match against the `iss` claim Gatekeeper signs (scheme + host + port, no trailing slash).                                                       |
| `DEV_INSTANCE_ISSUER_URL`  | Stub provisioner's instance URL for new sign-ups. Same value as the host in `GATEKEEPER_ISSUERS` for single-instance setups.                                                                                                       |
| `DEV_INSTANCE_CUSTOMER_ID` | Customer slug for the dev instance (matches the `cid` claim Gatekeeper puts on access tokens).                                                                                                                                     |
| `DATABASE_URL`             | MySQL connection string. Leave at the default for the local container. Unset entirely to fall back to in-memory repos (tests do this).                                                                                             |

**Optional** highlights — everything else has a default, but these come up:

| Var                   | Default                 | When to override                                                                                                                                                   |
| --------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ADMIN_API_KEY`       | empty                   | Set to enable `POST /api/admin/users` for operator-driven onboarding. `openssl rand -hex 32`.                                                                      |
| `DOMO_OAUTH_SCOPES`   | full 8-scope set        | Narrow if you want to test a token with fewer scopes.                                                                                                              |
| `MAGIC_LINK_BASE_URL` | `http://localhost:5173` | Change only if your SPA dev server runs somewhere else.                                                                                                            |
| `DEV_TOKEN`           | empty                   | Set to a Domo developer token if you want the legacy `DomoAuthGuard` dev fallback. Required for some pre-Layer-A tests; not needed for the magic-link + PKCE flow. |

## Booting the stack

```bash
# 1. Infra (MySQL + Mailpit) — boots in the background, healthcheck blocks until ready.
pnpm infra:up

# 2. BFF — applies pending migrations on first boot when DATABASE_RUN_MIGRATIONS=true.
pnpm start:dev
```

That's it. The Vite dev server in `~/dev/huckleberry` proxies `/api/*` to the BFF at `:3000`, so you visit `http://localhost:5173` in the browser.

`pnpm infra:up` brings up two services:

| Service | Port | UI / use |
|---|---|---|
| `huckleberry-mysql` (MySQL 8.4) | `3306` | The persistent store. Inspect with `pnpm db:studio` or `podman exec -it huckleberry-mysql mysql ...`. |
| `huckleberry-mailpit` (Mailpit) | `1025` SMTP, `8025` web UI | Captures every magic-link email. Open `http://localhost:8025` to see them, click the link to consume. Nothing leaves the container. |

## Day-to-day commands

### BFF

```bash
pnpm start:dev                  # Nest watch mode
VERBOSE_LOGGING=true pnpm start:dev    # log every HTTP request
pnpm test                       # unit tests (uses in-memory repos)
pnpm test:e2e                   # e2e specs
pnpm lint                       # ESLint + Prettier
```

### Database

```bash
pnpm infra:up     # boot MySQL + Mailpit
pnpm infra:down   # stop both; MySQL volume persists, Mailpit inbox is in-memory
pnpm infra:reset  # stop + nuke MySQL volume; next infra:up starts fresh

pnpm db:migrate   # apply pending migrations against $DATABASE_URL
pnpm db:generate  # diff schema.ts → write a new migration SQL file
pnpm db:studio    # Drizzle Studio web UI at localhost:4983
```

### Inspecting MySQL directly

```bash
podman exec -it huckleberry-mysql \
  mysql -uhuckleberry -phuckleberry huckleberry
```

Useful one-liners inside the mysql shell:

- `SHOW TABLES;`
- `SELECT HEX(id), email, status FROM users;` — `HEX(...)` because IDs are `BINARY(16)`.
- `SELECT sid, HEX(user_id), expires_at FROM sessions;`

## Editing the schema

1. Edit `src/common/db/schema.ts`.
2. `pnpm db:generate` — emits a new SQL file under `./drizzle/`.
3. Inspect the generated SQL. Adjust if Drizzle's diff is wrong (e.g., a rename, which it'll detect as drop+create unless you guide it).
4. `pnpm db:migrate` — applies it.
5. Commit both the `schema.ts` change and the new `drizzle/*.sql` file together.

Migration files are committed to the repo and run unchanged in production by the deploy-time runner described in `docs/diagrams/aurora-integration.md`.

## End-to-end sign-up flow (smoke test for a new dev)

After `pnpm infra:up` + `pnpm start:dev` are running, plus the SPA dev server in the other repo:

1. Open `http://localhost:5173/login?mode=signup`. Enter your email (any address — Mailpit captures it; nothing escapes the container). Submit.
2. Open Mailpit at `http://localhost:8025`. You'll see "Your huckleberry sign-in link" appear within a second. Click it.
   - (If `SMTP_HOST` is unset the BFF falls back to `ConsoleEmailService` — paste the URL from the BFF console into the browser instead. In prod, `SES_FROM` activates `SesEmailService` instead of SMTP — see `docs/deployment-bff.md`.)
3. AuthGuard sees `status=pending_link` and redirects to Gatekeeper's `/oauth2/authorize`.
4. Sign in on Domo. Gatekeeper redirects back to `/api/auth/domo/callback`.
5. BFF persists the refresh token, flips your user to `active`, lands you at `/workspace?linked=1`.
6. Verify persistence: `Ctrl-C` the BFF, `pnpm start:dev` again. Refresh the workspace tab. Cookie + user + refresh-token survive — that's MySQL doing its job.

## Troubleshooting

| Symptom                                                                | Fix                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ERR_PNPM_UNEXPECTED_STORE` on `pnpm install`                          | Your local pnpm version differs from the one that wrote the lockfile. `corepack prepare pnpm@10.5.0 --activate` and retry.                                                                                                                                                                         |
| `podman machine start` says it's already running but no API socket     | `podman machine stop && podman machine start`. On macOS the VM occasionally orphans the socket on sleep/wake.                                                                                                                                                                                      |
| `pnpm infra:up` succeeds but `db:migrate` errors `ECONNREFUSED`        | MySQL isn't ready yet. Wait a few seconds or `podman logs huckleberry-mysql` to see when `ready for connections` prints. The container healthcheck normally gates this.                                                                                                                            |
| BFF boots with the in-memory log line despite `DATABASE_URL` being set | The BFF didn't load `.env` for that process — confirm you're running `pnpm start:dev` from the repo root, not a parent directory.                                                                                                                                                                  |
| Migration runs but `users` is empty after sign-up                      | The sign-up call almost certainly failed silently. Check the BFF logs for `[SignupService]`. The most common cause is `DEV_INSTANCE_ISSUER_URL` / `DEV_INSTANCE_CUSTOMER_ID` not set, so the stub provisioner throws 503.                                                                          |
| AuthGuard bounces to homepage after Domo login (no `?code=` in URL)    | Pre-authenticate to the Domo instance in a separate tab first (sign in at `https://your-instance.domo.com`), then run the huckleberry sign-up flow. Known DomoWeb redirect quirk on the labs instance.                                                                                             |
| Token returns `iss.host does not match request host`                   | Mismatch between the host in the access token's `iss` claim and the host the BFF is calling. Confirm `GATEKEEPER_ISSUERS` matches the token's `iss` byte-for-byte (scheme, host, port — no trailing slash). If it does, escalate to the Gatekeeper team using `scripts/gatekeeper-scope-repro.sh`. |
| `403 insufficient_scope` on a downstream Domo call                     | The active access token doesn't carry the required scope. Refresh tokens are pinned to the scope set they were issued with — widen `DOMO_OAUTH_SCOPES`, update the client via Postman's `3b. RFC 7592 — update registration`, then sign up a fresh user to mint a new refresh token.               |

## What's out of scope locally

These come into play in production but not on your laptop:

- **IAM database auth.** Local MySQL uses password; Aurora uses a 15-minute IAM token signed from the ECS task role.
- **RDS Proxy.** Local pool talks directly to MySQL; prod goes through a proxy for connection multiplexing.
- **KMS envelope encryption on `refresh_token`.** Local dev encrypts with a static AES-256-GCM key (`DEV_ENCRYPTION_KEY` in `.env`) — no KMS calls. Production uses per-row DEKs wrapped by AWS KMS (flip is a single env var once Adam's key arrives).
- **Multi-AZ failover, replica lag, deadlock alarms.** Single-node container locally; CloudWatch wiring happens in infra.
- **Secrets Manager / SSM.** Local uses `.env`; prod fetches via the SDK at boot and on rotation.

See `docs/diagrams/aurora-integration.md` for the full prod topology.
