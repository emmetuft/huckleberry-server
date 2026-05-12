export type AuthProvider = 'dev' | 'gatekeeper';

export interface AppConfig {
  /**
   * Domo tenant hostname used in single-tenant *dev* mode. In multi-tenant
   * production, `gatekeeperIssuers` is the source of truth for which Domo
   * instances we accept tokens from; `DomoProxyService` reads the target host
   * from `req.user.issuer` per request.
   *
   * This value is kept as the dev-mode fallback for two cases:
   *  - `DomoAuthGuard` (legacy `AUTH_PROVIDER=dev`) — no token to forward.
   *  - Local containers and remote dev instances pointed at by a single env.
   */
  domoInstanceUrl: string;
  devToken: string;
  nodeEnv: string;
  port: number;
  verboseLogging: boolean;
  huckleberryAgentId: string;
  neo4jUri: string;
  neo4jUser: string;
  neo4jPassword: string;
  neo4jDatabase: string;
  /**
   * Which guard runs on Category-A controllers.
   * - `dev` (default): the legacy `DomoAuthGuard` that accepts `DEV_TOKEN` /
   *   header passthrough.
   * - `gatekeeper`: the multi-tenant `GatekeeperAuthGuard` that verifies
   *   inbound OAuth 2.1 JWTs against the issuer's JWKS.
   */
  authProvider: AuthProvider;
  /**
   * Allowlist of issuer URLs we accept tokens from. Order doesn't matter.
   * Each entry must match the literal `iss` claim Gatekeeper writes into
   * the token (byte-for-byte: scheme, host, port).
   *
   * Sources, in order:
   *   1. `GATEKEEPER_ISSUERS` env (CSV)
   *   2. `GATEKEEPER_ISSUER` env (single-value legacy)
   *   3. `DOMO_INSTANCE_URL` (dev fallback)
   *
   * Stored as `string[]` so a future Aurora-backed tenant registry can swap
   * the storage without changing consumers.
   */
  gatekeeperIssuers: string[];
  /**
   * Optional per-issuer JWKS URI override. Map of `iss -> jwks-uri` parsed
   * from `GATEKEEPER_JWKS_URIS` (CSV of `iss=uri` pairs). Defaults to
   * `{iss}/oauth2/jwks` when not overridden — needed only when JWKS is
   * served on a different scheme/host than the issuer string
   * (e.g., dev instances sign HTTP issuers but expose HTTPS JWKS).
   */
  gatekeeperJwksUriOverrides: Record<string, string>;
  /**
   * Optional `aud` claim to enforce on inbound JWTs. Set per-deployment to
   * our registered Gatekeeper client_id; leave blank to skip aud validation.
   * Gatekeeper puts the issuing client_id in `aud`.
   */
  gatekeeperAudience: string;
  /**
   * HS256 signing key for the hb_session cookie. Must be set in any non-dev
   * environment — the app refuses to start without it when nodeEnv=production.
   * Generate with `openssl rand -hex 32`.
   */
  sessionSigningKey: string;
  /** Magic-link TTL in seconds. Default 900 (15 min). */
  magicLinkTtlSeconds: number;
  /** Huckleberry session TTL in seconds (sliding). Default 43200 (12h). */
  sessionTtlSeconds: number;
  /** URL prefix used in magic-link emails (e.g. http://localhost:3000). */
  magicLinkBaseUrl: string;
  /**
   * Shared secret for the operator admin endpoints. Required to hit
   * `POST /admin/users`. Leave blank in dev to disable admin endpoints.
   */
  adminApiKey: string;
}

const ALLOWED_AUTH_PROVIDERS: readonly AuthProvider[] = ['dev', 'gatekeeper'];

function parseAuthProvider(raw: string | undefined): AuthProvider {
  const v = (raw || 'dev').toLowerCase();
  return (ALLOWED_AUTH_PROVIDERS as readonly string[]).includes(v)
    ? (v as AuthProvider)
    : 'dev';
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

function parseIssuers(env: NodeJS.ProcessEnv): string[] {
  const csv = env.GATEKEEPER_ISSUERS || '';
  if (csv) {
    return csv
      .split(',')
      .map((s) => stripTrailingSlash(s.trim()))
      .filter(Boolean);
  }
  const single = env.GATEKEEPER_ISSUER || env.DOMO_INSTANCE_URL || '';
  return single ? [stripTrailingSlash(single)] : [];
}

function parseJwksOverrides(env: NodeJS.ProcessEnv): Record<string, string> {
  const overrides: Record<string, string> = {};
  // Singular legacy override applies to whatever the legacy single-issuer was.
  const legacy = env.GATEKEEPER_JWKS_URI;
  const legacyIssuer = env.GATEKEEPER_ISSUER || env.DOMO_INSTANCE_URL;
  if (legacy && legacyIssuer) {
    overrides[stripTrailingSlash(legacyIssuer)] = legacy;
  }
  // Plural override: comma-separated list of `iss=uri` pairs.
  const csv = env.GATEKEEPER_JWKS_URIS || '';
  if (csv) {
    for (const pair of csv.split(',').map((s) => s.trim()).filter(Boolean)) {
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const iss = stripTrailingSlash(pair.slice(0, eq).trim());
      const uri = pair.slice(eq + 1).trim();
      if (iss && uri) overrides[iss] = uri;
    }
  }
  return overrides;
}

export default (): { app: AppConfig } => ({
  app: {
    domoInstanceUrl: process.env.DOMO_INSTANCE_URL || '',
    devToken: process.env.DEV_TOKEN || '',
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    verboseLogging: process.env.VERBOSE_LOGGING === 'true',
    huckleberryAgentId: process.env.HUCKLEBERRY_AGENT_ID || '',
    neo4jUri: process.env.NEO4J_URI || '',
    neo4jUser: process.env.NEO4J_USER || 'neo4j',
    neo4jPassword: process.env.NEO4J_PASSWORD || '',
    neo4jDatabase: process.env.NEO4J_DATABASE || 'neo4j',
    authProvider: parseAuthProvider(process.env.AUTH_PROVIDER),
    gatekeeperIssuers: parseIssuers(process.env),
    gatekeeperJwksUriOverrides: parseJwksOverrides(process.env),
    gatekeeperAudience: process.env.GATEKEEPER_AUDIENCE || '',
    sessionSigningKey: process.env.SESSION_SIGNING_KEY || '',
    magicLinkTtlSeconds: parseInt(process.env.MAGIC_LINK_TTL_SECONDS || '900', 10),
    sessionTtlSeconds: parseInt(process.env.SESSION_TTL_SECONDS || '43200', 10),
    magicLinkBaseUrl: process.env.MAGIC_LINK_BASE_URL || 'http://localhost:3000',
    adminApiKey: process.env.ADMIN_API_KEY || '',
  },
});
