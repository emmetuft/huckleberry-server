import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AppConfig } from '../../common/config/configuration.js';

/**
 * LRU map capped at maxSize. On capacity, evicts the least-recently-used entry.
 * Map iteration order is insertion order, so the first key is always the LRU.
 * get() repositions the key at the MRU end; set() on a new key evicts the LRU
 * first if at capacity.
 */
class BoundedLruMap<K, V> {
  private readonly map = new Map<K, V>();
  constructor(private readonly maxSize: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const lru = this.map.keys().next().value as K | undefined;
      if (lru !== undefined) this.map.delete(lru);
    }
    this.map.set(key, value);
  }
}

// Max distinct keys per bucket map. Prevents unbounded Map growth driven by
// attacker-controlled email values cycling unique keys into the store.
const MAX_BUCKETS = 10_000;

/**
 * Global IP-based throttler guard. Wraps the default ThrottlerGuard to:
 * - Add `Retry-After` header on 429 responses
 * - Return a generic message (does not disclose which limit was hit)
 */
@Injectable()
export class HbThrottlerGuard extends ThrottlerGuard {
  protected throwThrottlingException(
    ctx: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const res = ctx.switchToHttp().getResponse<Response>();
    res.setHeader('Retry-After', Math.ceil(detail.ttl / 1000));
    throw new HttpException('too_many_requests', HttpStatus.TOO_MANY_REQUESTS);
  }
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Auth-specific rate limiter for signup and signin/request routes.
 * Checks two independent limits:
 *   - Per-email: 3 attempts per 15 min (prevents targeted brute-force)
 *   - Per-IP:    10 attempts per minute (prevents subnet scanning)
 *
 * In-memory store — counters reset on pod restart (acceptable for single-pod).
 */
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly emailBuckets = new BoundedLruMap<string, Bucket>(
    MAX_BUCKETS,
  );
  private readonly ipBuckets = new BoundedLruMap<string, Bucket>(MAX_BUCKETS);

  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const cfg = this.config.get<AppConfig>('app');

    const rawEmail = (req.body as { email?: unknown })?.email;
    const email =
      typeof rawEmail === 'string' ? rawEmail.toLowerCase().trim() : undefined;
    const ip = extractIp(req);

    if (email) {
      this.enforce(
        res,
        this.emailBuckets,
        email,
        cfg.throttleAuthEmailLimit,
        cfg.throttleAuthEmailTtl,
      );
    }
    if (ip) {
      this.enforce(
        res,
        this.ipBuckets,
        ip,
        cfg.throttleAuthIpLimit,
        cfg.throttleAuthIpTtl,
      );
    }
    return true;
  }

  private enforce(
    res: Response,
    store: BoundedLruMap<string, Bucket>,
    key: string,
    limit: number,
    ttl: number,
  ): void {
    const now = Date.now();
    const entry = store.get(key);
    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + ttl });
      return;
    }
    if (entry.count >= limit) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      throw new HttpException(
        'too_many_requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    entry.count++;
  }
}

/**
 * Per-IP rate limiter for GET /auth/signin (token consume).
 * Applies a tighter limit than the global default to slow token-stuffing attacks.
 * In-memory store — same acceptable-single-pod caveat as AuthRateLimitGuard.
 */
@Injectable()
export class ConsumeThrottlerGuard implements CanActivate {
  private readonly ipBuckets = new BoundedLruMap<string, Bucket>(MAX_BUCKETS);

  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const cfg = this.config.get<AppConfig>('app');
    const ip = extractIp(req);
    if (ip) {
      const now = Date.now();
      const entry = this.ipBuckets.get(ip);
      if (!entry || now > entry.resetAt) {
        this.ipBuckets.set(ip, {
          count: 1,
          resetAt: now + cfg.throttleConsumeTtl,
        });
      } else if (entry.count >= cfg.throttleConsumeLimit) {
        res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
        throw new HttpException(
          'too_many_requests',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      } else {
        entry.count++;
      }
    }
    return true;
  }
}

function extractIp(req: Request): string | null {
  // req.ip is already resolved correctly by Express given app.set('trust proxy', 1).
  // Reading X-Forwarded-For directly here would take the leftmost value, which is
  // client-controlled and trivially bypassable behind an ALB.
  return (req as Request & { ip?: string }).ip ?? null;
}
