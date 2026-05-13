import { Injectable } from '@nestjs/common';
import type { DomoOAuthTokens } from './types.js';

export interface DomoTokenStore {
  get(linkId: string): Promise<DomoOAuthTokens | null>;
  upsert(record: DomoOAuthTokens): Promise<DomoOAuthTokens>;
  delete(linkId: string): Promise<void>;
}

export const DOMO_TOKEN_STORE = Symbol('DomoTokenStore');

/**
 * MVP in-memory store. Plaintext today. When this moves to Aurora the
 * `refreshToken` field gets KMS envelope-encrypted (`refresh_iv`,
 * `refresh_dek_id` columns + per-row DEK) without changing this contract.
 */
@Injectable()
export class InMemoryDomoTokenStore implements DomoTokenStore {
  private readonly byLinkId = new Map<string, DomoOAuthTokens>();

  get(linkId: string): Promise<DomoOAuthTokens | null> {
    return Promise.resolve(this.byLinkId.get(linkId) ?? null);
  }

  upsert(record: DomoOAuthTokens): Promise<DomoOAuthTokens> {
    const next = { ...record, updatedAt: new Date() };
    this.byLinkId.set(record.linkId, next);
    return Promise.resolve(next);
  }

  delete(linkId: string): Promise<void> {
    this.byLinkId.delete(linkId);
    return Promise.resolve();
  }
}
