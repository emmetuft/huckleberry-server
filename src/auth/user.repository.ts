import { Injectable } from '@nestjs/common';
import type { User, UserStatus } from './types.js';

/**
 * Repository contract — implementations include the MVP in-memory store and
 * the future Aurora-backed store. Consumers depend on this interface, never
 * on a concrete impl, so the Aurora swap is mechanical.
 */
export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  insert(user: User): Promise<User>;
  updateStatus(id: string, status: UserStatus): Promise<User>;
  markEmailVerified(id: string): Promise<User>;
  touchLastLogin(id: string): Promise<User>;
}

export const USER_REPOSITORY = Symbol('UserRepository');

/**
 * MVP in-memory store. Lost on restart — replaced by an Aurora-backed
 * `UserRepository` impl once `TenantBoundConnection` lands.
 */
@Injectable()
export class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, User>();
  private readonly byEmail = new Map<string, string>();

  findById(id: string): Promise<User | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  findByEmail(email: string): Promise<User | null> {
    const id = this.byEmail.get(email.toLowerCase());
    return Promise.resolve(id ? (this.byId.get(id) ?? null) : null);
  }

  insert(user: User): Promise<User> {
    if (this.byEmail.has(user.email.toLowerCase())) {
      return Promise.reject(new Error(`email already exists: ${user.email}`));
    }
    this.byId.set(user.id, user);
    this.byEmail.set(user.email.toLowerCase(), user.id);
    return Promise.resolve(user);
  }

  updateStatus(id: string, status: UserStatus): Promise<User> {
    const user = this.byId.get(id);
    if (!user) return Promise.reject(new Error(`user not found: ${id}`));
    const next = { ...user, status, updatedAt: new Date() };
    this.byId.set(id, next);
    return Promise.resolve(next);
  }

  markEmailVerified(id: string): Promise<User> {
    const user = this.byId.get(id);
    if (!user) return Promise.reject(new Error(`user not found: ${id}`));
    const next = { ...user, emailVerified: true, updatedAt: new Date() };
    this.byId.set(id, next);
    return Promise.resolve(next);
  }

  touchLastLogin(id: string): Promise<User> {
    const user = this.byId.get(id);
    if (!user) return Promise.reject(new Error(`user not found: ${id}`));
    const now = new Date();
    const next = { ...user, lastLoginAt: now, updatedAt: now };
    this.byId.set(id, next);
    return Promise.resolve(next);
  }
}
