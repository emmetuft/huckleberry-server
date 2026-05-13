import { Injectable } from '@nestjs/common';
import type { LinkedDomoInstance } from './types.js';

export interface LinkRepository {
  findById(linkId: string): Promise<LinkedDomoInstance | null>;
  findActiveForUser(userId: string): Promise<LinkedDomoInstance | null>;
  insert(link: LinkedDomoInstance): Promise<LinkedDomoInstance>;
  touchLastUsed(linkId: string): Promise<void>;
  delete(linkId: string): Promise<void>;
}

export const LINK_REPOSITORY = Symbol('LinkRepository');

/**
 * MVP in-memory store. Lost on restart — swap for an Aurora-backed impl
 * once `TenantBoundConnection` is wired.
 *
 * Today the contract is single-link-per-user; the first row for a user
 * wins until that link is deleted. Multi-link UX is post-MVP.
 */
@Injectable()
export class InMemoryLinkRepository implements LinkRepository {
  private readonly byId = new Map<string, LinkedDomoInstance>();
  private readonly byUserId = new Map<string, string>();

  findById(linkId: string): Promise<LinkedDomoInstance | null> {
    return Promise.resolve(this.byId.get(linkId) ?? null);
  }

  findActiveForUser(userId: string): Promise<LinkedDomoInstance | null> {
    const id = this.byUserId.get(userId);
    return Promise.resolve(id ? (this.byId.get(id) ?? null) : null);
  }

  insert(link: LinkedDomoInstance): Promise<LinkedDomoInstance> {
    this.byId.set(link.id, link);
    this.byUserId.set(link.userId, link.id);
    return Promise.resolve(link);
  }

  touchLastUsed(linkId: string): Promise<void> {
    const link = this.byId.get(linkId);
    if (!link) return Promise.resolve();
    this.byId.set(linkId, { ...link, lastUsedAt: new Date() });
    return Promise.resolve();
  }

  delete(linkId: string): Promise<void> {
    const link = this.byId.get(linkId);
    if (!link) return Promise.resolve();
    this.byId.delete(linkId);
    if (this.byUserId.get(link.userId) === linkId) {
      this.byUserId.delete(link.userId);
    }
    return Promise.resolve();
  }
}
