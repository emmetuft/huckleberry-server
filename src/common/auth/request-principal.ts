/**
 * Identity attached to `request.user` by `GatekeeperAuthGuard`.
 * Source of truth for who is calling: derived entirely from the verified JWT.
 */
export interface RequestPrincipal {
  /** Stable customer slug parsed from the iss hostname (e.g. 'cust1'). */
  customerId: string;
  /** Gatekeeper user identifier from the `sub` claim. */
  sub: string;
  /** Space-separated `scope` claim split into an array. */
  scopes: string[];
  /** The raw Bearer JWT — forwarded verbatim to downstream Domo APIs. */
  rawToken: string;
  /** Full `iss` URL — kept for audit, not for routing. */
  issuer: string;
}
