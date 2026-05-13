import { Injectable } from '@nestjs/common';
import type { PendingLinkState } from './types.js';

export interface OAuthStateStore {
  insert(state: PendingLinkState): Promise<void>;
  /** Atomic find-and-delete. Returns null if missing/expired. */
  consume(stateKey: string, now: Date): Promise<PendingLinkState | null>;
}

export const OAUTH_STATE_STORE = Symbol('OAuthStateStore');

/**
 * Holds the per-flow PKCE `code_verifier` and `state` nonce between
 * `/link/start` and `/callback`. ~10 minute TTL.
 *
 * Future swap target: Redis `SET link_init:<state> ... EX 600`.
 */
@Injectable()
export class InMemoryOAuthStateStore implements OAuthStateStore {
  private readonly byState = new Map<string, PendingLinkState>();

  insert(state: PendingLinkState): Promise<void> {
    this.byState.set(state.state, state);
    return Promise.resolve();
  }

  consume(stateKey: string, now: Date): Promise<PendingLinkState | null> {
    const found = this.byState.get(stateKey);
    if (!found) return Promise.resolve(null);
    this.byState.delete(stateKey);
    if (found.expiresAt.getTime() <= now.getTime())
      return Promise.resolve(null);
    return Promise.resolve(found);
  }
}
