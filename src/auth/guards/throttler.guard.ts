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
  private readonly emailBuckets = new Map<string, Bucket>();
  private readonly ipBuckets = new Map<string, Bucket>();

  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const cfg = this.config.get<AppConfig>('app');

    const email = (req.body as { email?: string })?.email?.toLowerCase().trim();
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
    store: Map<string, Bucket>,
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

function extractIp(req: Request): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0].trim();
  return (req as Request & { ip?: string }).ip ?? null;
}
