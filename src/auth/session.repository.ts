import { Injectable } from '@nestjs/common';
import type { Session } from './types.js';

export interface SessionRepository {
  get(sid: string): Promise<Session | null>;
  insert(session: Session): Promise<Session>;
  touch(sid: string, newExpiresAt: Date): Promise<Session | null>;
  revoke(sid: string): Promise<void>;
  /** Revoke every session for a user (e.g., admin disable, password change post-MVP). */
  revokeAllForUser(userId: string): Promise<number>;
}

export const SESSION_REPOSITORY = Symbol('SessionRepository');

/**
 * MVP in-memory store. Future swap target is Redis (`SET session:<sid>` with
 * EX/PX TTL); the `expiresAt` field stays in app code for sliding-renewal
 * semantics rather than relying solely on Redis TTL.
 */
@Injectable()
export class InMemorySessionRepository implements SessionRepository {
  private readonly bySid = new Map<string, Session>();

  async get(sid: string): Promise<Session | null> {
    const s = this.bySid.get(sid);
    if (!s) return null;
    if (s.expiresAt.getTime() <= Date.now()) {
      this.bySid.delete(sid);
      return null;
    }
    return s;
  }

  async insert(session: Session): Promise<Session> {
    this.bySid.set(session.sid, session);
    return session;
  }

  async touch(sid: string, newExpiresAt: Date): Promise<Session | null> {
    const s = this.bySid.get(sid);
    if (!s) return null;
    const next = { ...s, expiresAt: newExpiresAt, lastSeenAt: new Date() };
    this.bySid.set(sid, next);
    return next;
  }

  async revoke(sid: string): Promise<void> {
    this.bySid.delete(sid);
  }

  async revokeAllForUser(userId: string): Promise<number> {
    let removed = 0;
    for (const [sid, s] of this.bySid) {
      if (s.userId === userId) {
        this.bySid.delete(sid);
        removed++;
      }
    }
    return removed;
  }
}
