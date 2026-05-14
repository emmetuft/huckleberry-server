import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Session } from '../../../auth/types.js';
import type { SessionRepository } from '../../../auth/session.repository.js';
import { DRIZZLE, type Db } from '../db.module.js';
import { sessions } from '../schema.js';
import { binaryToUuid, uuidToBinary } from '../uuid.js';

type SessionRow = typeof sessions.$inferSelect;

function fromRow(row: SessionRow): Session {
  return {
    sid: row.sid,
    userId: binaryToUuid(row.userId),
    expiresAt: row.expiresAt,
    csrfToken: row.csrfToken,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
  };
}

@Injectable()
export class MysqlSessionRepository implements SessionRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async get(sid: string): Promise<Session | null> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.sid, sid))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    // Lazy eviction matches the in-memory impl.
    if (row.expiresAt.getTime() <= Date.now()) {
      await this.revoke(sid);
      return null;
    }
    return fromRow(row);
  }

  async insert(session: Session): Promise<Session> {
    await this.db.insert(sessions).values({
      sid: session.sid,
      userId: uuidToBinary(session.userId),
      expiresAt: session.expiresAt,
      csrfToken: session.csrfToken,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
    });
    return session;
  }

  async touch(sid: string, newExpiresAt: Date): Promise<Session | null> {
    const now = new Date();
    const [result] = await this.db
      .update(sessions)
      .set({ expiresAt: newExpiresAt, lastSeenAt: now })
      .where(eq(sessions.sid, sid));
    const affected = (result as { affectedRows?: number }).affectedRows ?? 0;
    if (affected === 0) return null;
    return this.get(sid);
  }

  async revoke(sid: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.sid, sid));
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const [result] = await this.db
      .delete(sessions)
      .where(eq(sessions.userId, uuidToBinary(userId)));
    return (result as { affectedRows?: number }).affectedRows ?? 0;
  }
}
