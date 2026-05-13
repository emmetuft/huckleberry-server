import { Injectable } from '@nestjs/common';
import type { MagicLink } from './types.js';

export interface MagicLinkRepository {
  insert(link: MagicLink): Promise<MagicLink>;
  /**
   * Atomic find + mark-consumed. Returns the link if it was valid and
   * unconsumed; null otherwise. Implementations MUST guarantee at-most-one
   * caller can win the consume race for a given tokenHash.
   */
  consume(tokenHash: string, now: Date): Promise<MagicLink | null>;
  /** Sweep expired and consumed-long-ago rows. Called by the maintenance worker. */
  deleteExpired(before: Date): Promise<number>;
}

export const MAGIC_LINK_REPOSITORY = Symbol('MagicLinkRepository');

/**
 * MVP in-memory store. `consume` uses a synchronous test-and-set to guarantee
 * at-most-one winner without locks (Node single-threaded event loop).
 */
@Injectable()
export class InMemoryMagicLinkRepository implements MagicLinkRepository {
  private readonly byHash = new Map<string, MagicLink>();

  insert(link: MagicLink): Promise<MagicLink> {
    this.byHash.set(link.tokenHash, link);
    return Promise.resolve(link);
  }

  consume(tokenHash: string, now: Date): Promise<MagicLink | null> {
    const link = this.byHash.get(tokenHash);
    if (!link) return Promise.resolve(null);
    if (link.consumedAt) return Promise.resolve(null);
    if (link.expiresAt.getTime() <= now.getTime()) return Promise.resolve(null);
    const consumed = { ...link, consumedAt: now };
    this.byHash.set(tokenHash, consumed);
    return Promise.resolve(consumed);
  }

  deleteExpired(before: Date): Promise<number> {
    let removed = 0;
    for (const [hash, link] of this.byHash) {
      if (link.expiresAt.getTime() < before.getTime()) {
        this.byHash.delete(hash);
        removed++;
      }
    }
    return Promise.resolve(removed);
  }
}
