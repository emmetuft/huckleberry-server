/**
 * Drizzle schema — source of truth for the local MySQL + future Aurora layout.
 *
 * Column shapes mirror `docs/authentication.md` § Schema. Phase 1 covers
 * Layer A: users, magic_links, sessions. Phase 2 adds linked_domo_instances
 * and domo_oauth_tokens. Category B tables (personas, mcp_*) wait on
 * TenantBoundConnection.
 *
 * UUID primary keys are stored as BINARY(16) for index compactness. The
 * application layer hands strings; the repositories convert at the edge via
 * `src/common/db/uuid.ts`.
 */
import {
  mysqlTable,
  customType,
  varchar,
  text,
  datetime,
  tinyint,
  mysqlEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';

/**
 * BINARY(16) column typed as Buffer in TS. Drizzle's built-in `binary()`
 * infers as `string`, but mysql2 returns BINARY values as Buffer at
 * runtime — so we'd have a runtime/type mismatch using the built-in.
 */
const binary16 = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'binary(16)',
});

export const users = mysqlTable(
  'users',
  {
    id: binary16('id').primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    emailVerified: tinyint('email_verified').notNull().default(0),
    displayName: varchar('display_name', { length: 255 }),
    status: mysqlEnum('status', [
      'pending_provision',
      'pending_link',
      'active',
      'suspended',
    ]).notNull(),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
    lastLoginAt: datetime('last_login_at', { fsp: 3 }),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email)],
);

export const magicLinks = mysqlTable(
  'magic_links',
  {
    /** SHA-256 hex of the raw token (64 chars). */
    tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
    userId: binary16('user_id').notNull(),
    expiresAt: datetime('expires_at', { fsp: 3 }).notNull(),
    consumedAt: datetime('consumed_at', { fsp: 3 }),
    /** IPv4 or IPv6 — 45 chars covers `[::ffff:x.x.x.x]` form. */
    ipIssuedFrom: varchar('ip_issued_from', { length: 45 }),
  },
  (t) => [
    index('magic_links_user_id_idx').on(t.userId),
    index('magic_links_expires_at_idx').on(t.expiresAt),
  ],
);

export const sessions = mysqlTable(
  'sessions',
  {
    /** Random base64url string from SessionService. Not a UUID. */
    sid: varchar('sid', { length: 64 }).primaryKey(),
    userId: binary16('user_id').notNull(),
    expiresAt: datetime('expires_at', { fsp: 3 }).notNull(),
    csrfToken: varchar('csrf_token', { length: 64 }).notNull(),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    lastSeenAt: datetime('last_seen_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);

/**
 * Per-user Domo OAuth linkage. One row per (huckleberry user, Domo instance).
 * Created in `pending_link` state at sign-up with `domoSub` null; filled in
 * after the PKCE callback completes and `domo_oauth_tokens` is seeded.
 */
export const linkedDomoInstances = mysqlTable(
  'linked_domo_instances',
  {
    id: binary16('id').primaryKey(),
    userId: binary16('user_id').notNull(),
    issuerUrl: varchar('issuer_url', { length: 255 }).notNull(),
    customerId: varchar('customer_id', { length: 64 }).notNull(),
    /** Domo user id (the `sub` claim). Null until the first PKCE flow completes. */
    domoSub: varchar('domo_sub', { length: 64 }),
    scope: varchar('scope', { length: 1000 }).notNull(),
    linkedAt: datetime('linked_at', { fsp: 3 }).notNull(),
    lastUsedAt: datetime('last_used_at', { fsp: 3 }),
  },
  (t) => [
    index('linked_domo_user_id_idx').on(t.userId),
    index('linked_domo_customer_id_idx').on(t.customerId),
  ],
);

/**
 * OAuth refresh tokens — separate table from `linked_domo_instances` so
 * rotation writes don't churn the link row, and the encryption boundary
 * (plaintext locally → KMS envelope in Aurora) can change without touching
 * the link schema.
 */
export const domoOauthTokens = mysqlTable('domo_oauth_tokens', {
  linkId: binary16('link_id').primaryKey(),
  /** Plaintext locally. Aurora will hold AES-GCM ciphertext in this column. */
  refreshToken: varchar('refresh_token', { length: 2000 }).notNull(),
  scope: varchar('scope', { length: 1000 }).notNull(),
  updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
});

/**
 * Per-instance OAuth client credentials. One row per Domo instance (issuerUrl).
 * Created via DCR (`POST {issuerUrl}/oauth2/register`) during provisioning or
 * on the first `link/start` for an instance we haven't seen before.
 */
export const domoOauthClients = mysqlTable('domo_oauth_clients', {
  issuerUrl: varchar('issuer_url', { length: 255 }).primaryKey(),
  clientId: varchar('client_id', { length: 200 }).notNull(),
  registrationAccessToken: varchar('registration_access_token', {
    length: 2000,
  }),
  redirectUri: varchar('redirect_uri', { length: 500 }).notNull(),
  scope: varchar('scope', { length: 1000 }).notNull(),
  registeredAt: datetime('registered_at', { fsp: 3 }).notNull(),
  lastUsedAt: datetime('last_used_at', { fsp: 3 }),
});

export const personas = mysqlTable(
  'personas',
  {
    id: binary16('id').primaryKey(),
    customerId: varchar('customer_id', { length: 64 }).notNull(),
    userId: binary16('user_id').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    role: varchar('role', { length: 255 }).notNull().default(''),
    level: varchar('level', { length: 50 }).notNull().default(''),
    department: varchar('department', { length: 255 }).notNull().default(''),
    team: varchar('team', { length: 255 }),
    focusAreas: varchar('focus_areas', { length: 2000 })
      .notNull()
      .default('[]'),
    strengths: varchar('strengths', { length: 2000 }).notNull().default('[]'),
    weaknesses: varchar('weaknesses', { length: 2000 }).notNull().default('[]'),
    goals: varchar('goals', { length: 2000 }).notNull().default(''),
    isDefault: tinyint('is_default').notNull().default(0),
    usePersona: tinyint('use_persona').notNull().default(1),
    useActivity: tinyint('use_activity').notNull().default(1),
    useData: tinyint('use_data').notNull().default(1),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
  },
  (t) => [index('personas_tenant_idx').on(t.customerId, t.userId)],
);

export const mcpServers = mysqlTable(
  'mcp_servers',
  {
    id: binary16('id').primaryKey(),
    customerId: varchar('customer_id', { length: 64 }).notNull(),
    userId: binary16('user_id').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    url: varchar('url', { length: 2000 }).notNull(),
    enabled: tinyint('enabled').notNull().default(1),
    authType: varchar('auth_type', { length: 20 }).notNull().default('none'),
    bearerToken: varchar('bearer_token', { length: 2000 }),
    oauth2Config: text('oauth2_config'),
    tools: text('tools'),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
  },
  (t) => [index('mcp_servers_tenant_idx').on(t.customerId, t.userId)],
);
