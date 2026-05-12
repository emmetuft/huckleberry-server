import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { AppConfig } from '../common/config/configuration.js';
import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from './session.repository.js';
import type { Session } from './types.js';

export interface IssuedSession {
  sid: string;
  cookieValue: string;
  csrfToken: string;
  expiresAt: Date;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly signingKey: Uint8Array;
  private readonly ttlSeconds: number;

  constructor(
    config: ConfigService,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
  ) {
    const app = config.get<AppConfig>('app');
    const key = app?.sessionSigningKey ?? '';
    if (!key) {
      if (app?.nodeEnv === 'production') {
        throw new Error('SESSION_SIGNING_KEY is required in production');
      }
      this.logger.warn(
        'SESSION_SIGNING_KEY not set — using an ephemeral dev key. Sessions will not survive a restart.',
      );
      this.signingKey = randomBytes(32);
    } else {
      this.signingKey = Buffer.from(key, 'hex');
      if (this.signingKey.length < 32) {
        throw new Error(
          'SESSION_SIGNING_KEY must be at least 32 bytes (hex-encoded)',
        );
      }
    }
    this.ttlSeconds = app?.sessionTtlSeconds ?? 43200;
  }

  /** Issues a fresh session for a user. Returns the cookie value + CSRF token. */
  async issue(userId: string): Promise<IssuedSession> {
    const sid = randomUUID();
    const csrfToken = randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);

    const session: Session = {
      sid,
      userId,
      expiresAt,
      csrfToken,
      createdAt: now,
      lastSeenAt: now,
    };
    await this.sessions.insert(session);

    const cookieValue = await new SignJWT({ sid })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.signingKey);

    return { sid, cookieValue, csrfToken, expiresAt };
  }

  /**
   * Verifies the cookie JWT signature, validates the backing session row
   * exists and isn't expired, and slides the TTL on success.
   */
  async verifyAndTouch(cookieValue: string): Promise<Session> {
    let payload: JWTPayload;
    try {
      const result = await jwtVerify(cookieValue, this.signingKey, {
        algorithms: ['HS256'],
      });
      payload = result.payload;
    } catch (err) {
      throw new UnauthorizedException('invalid session');
    }
    const sid = typeof payload.sid === 'string' ? payload.sid : undefined;
    if (!sid || !payload.sub) {
      throw new UnauthorizedException('malformed session');
    }
    const session = await this.sessions.get(sid);
    if (!session || session.userId !== payload.sub) {
      throw new UnauthorizedException('session not found');
    }

    // Sliding TTL — push expiry forward on every valid request.
    const newExpiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    const touched = await this.sessions.touch(sid, newExpiresAt);
    return touched ?? session;
  }

  async revoke(sid: string): Promise<void> {
    await this.sessions.revoke(sid);
  }
}
