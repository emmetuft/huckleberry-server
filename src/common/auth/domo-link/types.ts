/**
 * Layer B — Domo OAuth linkage types.
 *
 * One `LinkedDomoInstance` per (huckleberry user, Domo instance) pair.
 * MVP supports one link per user; multi-link comes post-MVP. Tokens are
 * stored separately so the encryption boundary can swap (plaintext in-memory
 * today, KMS-encrypted Aurora later) without changing the link row.
 */

/**
 * Per-user OAuth linkage between a huckleberry user and a Domo instance.
 *
 * The BFF is a **public** OAuth 2.1 client to Gatekeeper — PKCE only, no
 * `client_secret` anywhere in our system. Each user does one browser-side
 * auth-code + PKCE flow against their Domo instance. The resulting refresh
 * token is per-user, rotated every use, and stored encrypted at rest.
 *
 * We do not store Domo passwords or service-wide client secrets. The only
 * Domo-issued material we hold is the user's refresh token, which Domo can
 * revoke at any time.
 */
export interface LinkedDomoInstance {
  id: string;
  userId: string;
  issuerUrl: string; // matches the `iss` claim Gatekeeper signs
  customerId: string; // `cid` claim — canonical Domo customer slug
  /** Domo user id (the `sub` claim on tokens issued for this user). Null until first OAuth completes. */
  domoSub: string | null;
  scope: string; // granted scopes (space-separated)
  linkedAt: Date;
  lastUsedAt: Date | null;
}

/**
 * Stored OAuth tokens for a link. Refresh tokens rotate every use per
 * Gatekeeper's OAuth 2.1 enforcement; persistence must be atomic with the
 * exchange call.
 */
export interface DomoOAuthTokens {
  linkId: string;
  /** Plaintext at MVP. KMS-encrypted ciphertext (+ DEK ref) when Aurora lands. */
  refreshToken: string;
  scope: string;
  updatedAt: Date;
}

/**
 * Transient state for an in-flight OAuth flow. Created on `link/start`,
 * looked up + consumed on `callback`. Short-lived (~10 min).
 */
export interface PendingLinkState {
  state: string;
  userId: string;
  issuerUrl: string;
  codeVerifier: string;
  createdAt: Date;
  expiresAt: Date;
}
