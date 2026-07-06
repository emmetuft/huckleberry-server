/**
 * Layer A — Huckleberry-native identity types.
 *
 * `User` is the system-of-record identity. Created by vetted operator tooling
 * with `status='pending_link'`; flips to `active` after first OAuth linkage
 * completes. Suspended is the admin-disable state.
 */

export type UserStatus =
  'pending_provision' | 'pending_link' | 'active' | 'suspended';

export interface User {
  /** UUID v4. We carry the canonical form as a string; persistence layer may store BINARY(16). */
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}

/**
 * Magic-link record — single-use, short-TTL email sign-in token.
 *
 * Only the SHA-256 hash of the raw token is stored. The raw token exists
 * exactly twice: in the outbound email and (briefly) in the BFF process
 * during issuance. A DB leak cannot replay these.
 */
export interface MagicLink {
  /** SHA-256 hex of the raw token. Primary key. */
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  consumedAt: Date | null;
  ipIssuedFrom: string | null;
}

/**
 * Session record — server-side state for an issued hb_session cookie.
 * Lets us revoke a session immediately without waiting for the JWT to expire.
 */
export interface Session {
  sid: string;
  userId: string;
  expiresAt: Date;
  csrfToken: string;
  createdAt: Date;
  lastSeenAt: Date;
}

/**
 * The principal attached to `request.user` by `SessionAuthGuard`.
 * Distinct from the Domo-side principal (which lives on `req.domoPrincipal`
 * when Layer B is involved). Keep these two namespaces explicit.
 */
export interface HuckleberryPrincipal {
  userId: string;
  sessionId: string;
  email: string;
  status: UserStatus;
}
