import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import type { MagicLink } from '../../../auth/types.js';
import type { MagicLinkRepository } from '../../../auth/magic-link.repository.js';
import { DRIZZLE, type Db } from '../db.module.js';
import { magicLinks } from '../schema.js';
import { binaryToUuid, uuidToBinary } from '../uuid.js';

type MagicLinkRow = typeof magicLinks.$inferSelect;

function fromRow(row: MagicLinkRow): MagicLink {
  return {
    tokenHash: row.tokenHash,
    userId: binaryToUuid(row.userId),
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    ipIssuedFrom: row.ipIssuedFrom,
  };
}

@Injectable()
export class MysqlMagicLinkRepository implements MagicLinkRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async insert(link: MagicLink): Promise<MagicLink> {
    await this.db.insert(magicLinks).values({
      tokenHash: link.tokenHash,
      userId: uuidToBinary(link.userId),
      expiresAt: link.expiresAt,
      consumedAt: link.consumedAt,
      ipIssuedFrom: link.ipIssuedFrom,
    });
    return link;
  }

  async consume(tokenHash: string, now: Date): Promise<MagicLink | null> {
    // Atomic mark-consumed: the UPDATE only matches an unconsumed, unexpired
    // row. mysql2's affectedRows tells us whether we won the race.
    const [result] = await this.db
      .update(magicLinks)
      .set({ consumedAt: now })
      .where(
        and(
          eq(magicLinks.tokenHash, tokenHash),
          isNull(magicLinks.consumedAt),
          gt(magicLinks.expiresAt, now),
        ),
      );
    // drizzle-orm/mysql2 returns [ResultSetHeader, FieldPacket[]] for updates.
    const affected = (result as { affectedRows?: number }).affectedRows ?? 0;
    if (affected === 0) return null;
    const rows = await this.db
      .select()
      .from(magicLinks)
      .where(eq(magicLinks.tokenHash, tokenHash))
      .limit(1);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async deleteExpired(before: Date): Promise<number> {
    const [result] = await this.db
      .delete(magicLinks)
      .where(lt(magicLinks.expiresAt, before));
    return (result as { affectedRows?: number }).affectedRows ?? 0;
  }
}
