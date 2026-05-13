import { SetMetadata } from '@nestjs/common';

export const SCOPES_KEY = 'requiredScopes';

/**
 * Declares the scope(s) required to invoke this route. OR semantics — the
 * token's `scope` claim must contain at least one of the listed values.
 * The guard rejects with `403 insufficient_scope` (RFC 6750) if none match.
 */
export const Scopes = (...scopes: string[]) => SetMetadata(SCOPES_KEY, scopes);
