import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { LinkedDomoInstance } from '../../auth/domo-link/types.js';
import type { LinkRepository } from '../../auth/domo-link/link.repository.js';
import { DRIZZLE, type Db } from '../db.module.js';
import { linkedDomoInstances } from '../schema.js';
import { binaryToUuid, uuidToBinary } from '../uuid.js';

type LinkRow = typeof linkedDomoInstances.$inferSelect;

function fromRow(row: LinkRow): LinkedDomoInstance {
  return {
    id: binaryToUuid(row.id),
    userId: binaryToUuid(row.userId),
    issuerUrl: row.issuerUrl,
    customerId: row.customerId,
    domoSub: row.domoSub,
    scope: row.scope,
    linkedAt: row.linkedAt,
    lastUsedAt: row.lastUsedAt,
  };
}

@Injectable()
export class MysqlLinkRepository implements LinkRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async findById(linkId: string): Promise<LinkedDomoInstance | null> {
    const rows = await this.db
      .select()
      .from(linkedDomoInstances)
      .where(eq(linkedDomoInstances.id, uuidToBinary(linkId)))
      .limit(1);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async findActiveForUser(userId: string): Promise<LinkedDomoInstance | null> {
    // Single-link-per-user at MVP — the first row for this user wins.
    const rows = await this.db
      .select()
      .from(linkedDomoInstances)
      .where(eq(linkedDomoInstances.userId, uuidToBinary(userId)))
      .limit(1);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async insert(link: LinkedDomoInstance): Promise<LinkedDomoInstance> {
    await this.db.insert(linkedDomoInstances).values({
      id: uuidToBinary(link.id),
      userId: uuidToBinary(link.userId),
      issuerUrl: link.issuerUrl,
      customerId: link.customerId,
      domoSub: link.domoSub,
      scope: link.scope,
      linkedAt: link.linkedAt,
      lastUsedAt: link.lastUsedAt,
    });
    return link;
  }

  async update(link: LinkedDomoInstance): Promise<LinkedDomoInstance> {
    await this.db
      .update(linkedDomoInstances)
      .set({
        userId: uuidToBinary(link.userId),
        issuerUrl: link.issuerUrl,
        customerId: link.customerId,
        domoSub: link.domoSub,
        scope: link.scope,
        linkedAt: link.linkedAt,
        lastUsedAt: link.lastUsedAt,
      })
      .where(eq(linkedDomoInstances.id, uuidToBinary(link.id)));
    return link;
  }

  async touchLastUsed(linkId: string): Promise<void> {
    await this.db
      .update(linkedDomoInstances)
      .set({ lastUsedAt: new Date() })
      .where(eq(linkedDomoInstances.id, uuidToBinary(linkId)));
  }

  async delete(linkId: string): Promise<void> {
    await this.db
      .delete(linkedDomoInstances)
      .where(and(eq(linkedDomoInstances.id, uuidToBinary(linkId))));
  }
}
