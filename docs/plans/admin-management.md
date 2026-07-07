# Admin Management Systems — Session & Platform Settings

## Context

Once real users are on the platform, operators need visibility and control over:
1. **Active sessions** — who's logged in, force-revoke compromised sessions
2. **Platform settings** — CORS origins, feature flags, operational knobs that shouldn't require a redeploy

Currently:
- Sessions live in an **in-memory Map** (lost on pod restart, no visibility)
- CORS is **env-var driven** (requires deploy to change)
- Admin endpoints are limited to `POST /admin/users` (onboarding only)

This plan introduces two systems: a durable session store with admin controls, and a runtime-configurable platform settings table.

---

## System 1: Session Management

### Current state

| Aspect | Today | Target |
|--------|-------|--------|
| Storage | In-memory Map | MySQL `sessions` table |
| Visibility | None | Admin API: list active sessions by user |
| Revocation | Logout only (self) | Admin: revoke by session, by user, or bulk |
| Persistence | Lost on restart | Survives deploys; TTL enforced at query time |
| Scalability | Single-pod only | Any number of pods reading the same table |

### Schema: `sessions`

```sql
CREATE TABLE sessions (
  sid          VARCHAR(64) PRIMARY KEY,
  user_id      BINARY(16) NOT NULL,
  csrf_token   VARCHAR(64) NOT NULL,
  ip_address   VARCHAR(45),
  user_agent   VARCHAR(512),
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at   DATETIME(3) NOT NULL,
  revoked_at   DATETIME(3) NULL,
  INDEX idx_sessions_user_id (user_id),
  INDEX idx_sessions_expires_at (expires_at)
) ENGINE=InnoDB;
```

**Notes:**
- `revoked_at` is set instead of deleting rows — supports audit trail
- `ip_address` + `user_agent` give operators context for suspicious sessions
- TTL enforcement: `WHERE revoked_at IS NULL AND expires_at > NOW()`

### Repository: `MysqlSessionRepository`

Implements existing `SessionRepository` interface. Drop-in replacement for `InMemorySessionRepository`. New methods:

```typescript
interface SessionRepository {
  // Existing
  get(sid: string): Promise<Session | null>;
  insert(session: Session): Promise<Session>;
  touch(sid: string, newExpiresAt: Date): Promise<Session | null>;
  revoke(sid: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<number>;
  // New — admin operations
  listByUser(userId: string): Promise<SessionSummary[]>;
  listActive(opts: { limit: number; offset: number }): Promise<SessionSummary[]>;
  countActive(): Promise<number>;
  revokeAll(): Promise<number>;  // nuclear option: mass sign-out
}
```

`SessionSummary` = `{ sid, userId, email, ipAddress, userAgent, createdAt, lastSeenAt, expiresAt }` — no `csrfToken` (never expose to admin UI).

### Admin API: Sessions

All under `POST /admin/sessions/*`, protected by `ADMIN_API_KEY`:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/sessions` | List active sessions (paginated). Query: `?userId=`, `?limit=`, `?offset=` |
| GET | `/admin/sessions/count` | Active session count |
| DELETE | `/admin/sessions/:sid` | Revoke one session |
| DELETE | `/admin/sessions/user/:userId` | Revoke all sessions for a user |
| DELETE | `/admin/sessions` | Revoke ALL sessions (emergency kill switch, requires confirmation header `X-Confirm-Bulk-Revoke: true`) |

### Session enrichment

When creating a session, capture `req.ip` and `req.headers['user-agent']`. Add to `Session` type:

```typescript
export interface Session {
  sid: string;
  userId: string;
  expiresAt: Date;
  csrfToken: string;
  createdAt: Date;
  lastSeenAt: Date;
  ipAddress: string | null;    // new
  userAgent: string | null;    // new
  revokedAt: Date | null;      // new (null = active)
}
```

### Migration path

1. Add `sessions` table via Drizzle migration
2. Implement `MysqlSessionRepository`
3. Swap DI binding in `AuthModule` (gated on `DATABASE_URL` presence — in-memory for unit tests)
4. Existing `SessionService` unchanged — it talks to the interface

---

## System 2: Platform Settings

### Why not just env vars?

Env vars require a redeploy. For settings that operators adjust reactively (block a bad origin, enable a feature for one customer, bump a rate limit during an incident), the feedback loop needs to be seconds, not minutes.

### Schema: `platform_settings`

```sql
CREATE TABLE platform_settings (
  setting_key   VARCHAR(128) PRIMARY KEY,
  setting_value JSON NOT NULL,
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by    VARCHAR(128) NOT NULL DEFAULT 'system'
) ENGINE=InnoDB;
```

A simple key-value store with typed JSON values. Not a config service replacement — only for the subset of settings that need runtime mutability.

### Initial settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `cors.origins` | `string[]` | `["*"]` | Allowed CORS origins. Falls back to `CORS_ORIGIN` env var if unset in DB. |
| `cors.enabled` | `boolean` | `true` | Master CORS toggle (disable = reject all cross-origin) |
| `auth.signupEnabled` | `boolean` | `true` | Kill switch for self-service signup |
| `auth.maxSessionsPerUser` | `number` | `10` | Hard cap on concurrent sessions per user |
| `mcp.globalEnabled` | `boolean` | `true` | Kill switch for all MCP server connectivity |
| `mcp.maxServersPerUser` | `number` | `5` | How many MCP servers a user can register |

### Service: `PlatformSettingsService`

```typescript
@Injectable()
export class PlatformSettingsService {
  private cache = new Map<string, { value: unknown; fetchedAt: number }>();
  private readonly CACHE_TTL_MS = 30_000; // 30s — short enough for quick changes

  async get<T>(key: string, fallback: T): Promise<T>;
  async set(key: string, value: unknown, updatedBy: string): Promise<void>;
  async getAll(): Promise<Record<string, unknown>>;
  invalidateCache(): void;
}
```

**Caching strategy:** In-memory cache with 30s TTL. On `set()`, invalidate immediately. Multi-pod: each pod reads from DB on cache miss — 30s eventual consistency is acceptable for these operational knobs. If tighter consistency is needed later, add a pub/sub invalidation channel.

### Admin API: Settings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/settings` | List all settings with current values |
| GET | `/admin/settings/:key` | Get one setting |
| PUT | `/admin/settings/:key` | Update a setting. Body: `{ value: <any> }` |
| DELETE | `/admin/settings/:key` | Reset to default (deletes row; service returns fallback) |

### Integration with existing code

**CORS** — `main.ts` bootstrap reads from env var. At runtime, a middleware checks `PlatformSettingsService.get('cors.origins')` on each request and validates the `Origin` header. This replaces the static `app.enableCors()` with a dynamic check.

```typescript
// Dynamic CORS middleware (replaces static enableCors)
@Injectable()
export class DynamicCorsMiddleware implements NestMiddleware {
  constructor(private readonly settings: PlatformSettingsService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const origin = req.headers.origin;
    if (!origin) return next();

    const allowed = await this.settings.get<string[]>('cors.origins', ['*']);
    if (allowed.includes('*') || allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-CSRF-Token');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  }
}
```

**Signup gate** — `SignupService.ensureUser()` checks `auth.signupEnabled` before proceeding.

**Session cap** — `SessionService.create()` checks `auth.maxSessionsPerUser`; if at cap, revokes the oldest session before creating a new one.

---

## Implementation Phases

### Phase A: Durable Sessions (prerequisite — high value)

1. Drizzle migration: `sessions` table
2. `MysqlSessionRepository` implementing the full interface
3. Enrich `Session` type with `ipAddress`, `userAgent`, `revokedAt`
4. Swap DI binding (keep `InMemorySessionRepository` for tests)
5. Admin session endpoints (list, revoke, bulk revoke)
6. E2e tests: admin can list/revoke sessions; revoked session returns 401

**External deps:** None (MySQL already available).

### Phase B: Platform Settings (builds on Phase A)

1. Drizzle migration: `platform_settings` table
2. `PlatformSettingsService` with cache
3. Admin settings CRUD endpoints
4. `DynamicCorsMiddleware` (replaces static `enableCors`)
5. Wire signup gate + session cap
6. E2e tests: change CORS origin via admin API → subsequent request from old origin rejected

**External deps:** None.

### Phase C: Admin UI (frontend — separate repo)

1. `/admin/sessions` page — table of active sessions with user email, IP, last seen, revoke button
2. `/admin/settings` page — key-value editor with type-aware inputs (boolean toggle, string array chips, number input)
3. Bulk revoke confirmation modal
4. Protected by admin role (when RBAC lands) or `ADMIN_API_KEY` in the interim

**External deps:** Frontend repo work. Can be deferred — the API is usable via curl/Postman immediately.

---

## Decisions to make

| Question | Options | Recommendation |
|----------|---------|----------------|
| Session storage for horizontal scale | MySQL (simple, already have it) vs Redis (faster, purpose-built) | **MySQL** — we're single-pod today, don't need sub-ms session reads. Add Redis when latency matters. |
| Settings cache invalidation across pods | Poll (30s TTL) vs pub/sub (instant) | **Poll** — single-pod today. 30s is fine for operational knobs. |
| Admin auth | `ADMIN_API_KEY` header (current) vs dedicated admin role in RBAC | **API key for now** — RBAC is a separate body of work. When it lands, admin endpoints check `role === 'admin'` instead. |
| Signup gate UX | 403 with message vs redirect to waitlist | **403 with `signup_disabled` code** — frontend renders the message. |

---

## Verification

Each phase:
1. `pnpm lint` — 0 errors
2. `pnpm test` — no regressions
3. `pnpm test:e2e` — new admin endpoint tests pass
4. Manual: revoke a session via admin API, verify user is 401'd on next request
5. Manual: change CORS origin via admin API, verify browser request from old origin is blocked

---

## Non-goals (explicit exclusions)

- **RBAC / roles** — separate initiative. Admin endpoints stay API-key-gated for now.
- **Audit log viewer in admin UI** — Phase 8 (housekeeping) adds structured audit events. Viewing them is a log aggregation concern (Grafana/CloudWatch), not an in-app concern yet.
- **Per-user feature flags** — if needed, extend `platform_settings` with a `scope` column (`global` vs `user:<id>`). Not building this until there's a concrete use case.
- **Settings history / rollback** — the `updated_at` + `updated_by` columns give minimal audit. Full history (every change as a row) is over-engineering for the current scale.
