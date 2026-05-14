import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { User, UserStatus } from '../../../auth/types.js';
import type { UserRepository } from '../../../auth/user.repository.js';
import { DRIZZLE, type Db } from '../db.module.js';
import { users } from '../schema.js';
import { binaryToUuid, uuidToBinary } from '../uuid.js';

type UserRow = typeof users.$inferSelect;

function fromRow(row: UserRow): User {
  return {
    id: binaryToUuid(row.id),
    email: row.email,
    emailVerified: row.emailVerified === 1,
    displayName: row.displayName,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt,
  };
}

@Injectable()
export class MysqlUserRepository implements UserRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async findById(id: string): Promise<User | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.id, uuidToBinary(id)))
      .limit(1);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async insert(user: User): Promise<User> {
    await this.db.insert(users).values({
      id: uuidToBinary(user.id),
      email: user.email.toLowerCase(),
      emailVerified: user.emailVerified ? 1 : 0,
      displayName: user.displayName,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
    });
    return user;
  }

  async updateStatus(id: string, status: UserStatus): Promise<User> {
    const idBin = uuidToBinary(id);
    const now = new Date();
    await this.db
      .update(users)
      .set({ status, updatedAt: now })
      .where(eq(users.id, idBin));
    const fresh = await this.findById(id);
    if (!fresh) throw new Error(`user not found: ${id}`);
    return fresh;
  }

  async markEmailVerified(id: string): Promise<User> {
    const idBin = uuidToBinary(id);
    const now = new Date();
    await this.db
      .update(users)
      .set({ emailVerified: 1, updatedAt: now })
      .where(eq(users.id, idBin));
    const fresh = await this.findById(id);
    if (!fresh) throw new Error(`user not found: ${id}`);
    return fresh;
  }

  async touchLastLogin(id: string): Promise<User> {
    const idBin = uuidToBinary(id);
    const now = new Date();
    await this.db
      .update(users)
      .set({ lastLoginAt: now, updatedAt: now })
      .where(eq(users.id, idBin));
    const fresh = await this.findById(id);
    if (!fresh) throw new Error(`user not found: ${id}`);
    return fresh;
  }
}
