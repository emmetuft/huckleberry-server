/**
 * Rate limiting end-to-end tests — Phase 3 (THR-TB01-D-01, THR-TB01-I-01)
 *
 * Three isolated describe blocks, each with their own Nest app instance so
 * the AuthRateLimitGuard's in-memory buckets start empty for each group.
 *
 * Limits configured for fast execution (defaults are higher in production):
 *   - email: 3 attempts per 15 min
 *   - IP:    5 attempts per min (low enough to test, high enough that email
 *            tests with 3 requests don't inadvertently trigger it)
 *   - consume: 3 attempts per min
 */

process.env.NODE_ENV = 'development';
process.env.PORT = '0';
process.env.SESSION_SIGNING_KEY =
  '0000000000000000000000000000000000000000000000000000000000000001';
process.env.ADMIN_API_KEY = 'test-admin-key';
process.env.MAGIC_LINK_BASE_URL = 'http://localhost:5173';
process.env.MAGIC_LINK_TTL_SECONDS = '900';
process.env.SESSION_TTL_SECONDS = '43200';
process.env.DEV_INSTANCE_ISSUER_URL = 'http://stub.test:443';
process.env.DEV_INSTANCE_CUSTOMER_ID = 'stub';
process.env.DEV_INSTANCE_OAUTH_CLIENT_ID = 'stub-client-id';
process.env.DEV_INSTANCE_OAUTH_CLIENT_SECRET = 'stub-client-secret';
process.env.DEV_INSTANCE_SCOPES = 'ai:read';
// Low limits for fast test execution
process.env.THROTTLE_GLOBAL_LIMIT = '1000';
process.env.THROTTLE_AUTH_EMAIL_LIMIT = '3';
process.env.THROTTLE_AUTH_EMAIL_TTL = '900000';
process.env.THROTTLE_AUTH_IP_LIMIT = '5';
process.env.THROTTLE_AUTH_IP_TTL = '60000';
process.env.THROTTLE_CONSUME_LIMIT = '3';
process.env.THROTTLE_CONSUME_TTL = '60000';

import { jest } from '@jest/globals';
import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DomoExceptionFilter } from '../src/common/filters/domo-exception.filter';
import { ResponseEnvelopeInterceptor } from '../src/common/interceptors/response-envelope.interceptor';
import {
  EMAIL_SERVICE,
  type EmailService,
  type MagicLinkEmail,
} from '../src/auth/email.service';

async function buildApp(): Promise<INestApplication<App>> {
  const emails: EmailService = {
    sendMagicLink: jest.fn<(e: MagicLinkEmail) => Promise<void>>().mockResolvedValue(undefined),
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EMAIL_SERVICE)
    .useValue(emails)
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health', method: RequestMethod.ALL },
      { path: 'domo/*path', method: RequestMethod.ALL },
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new DomoExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  await app.init();
  return app;
}

describe('Rate limiting — email limit (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it('allows up to 3 signup requests per email then blocks', async () => {
    const srv = app.getHttpServer() as Parameters<typeof request>[0];
    const body = { email: 'rl-email1@test.com', path: 'new' };

    await request(srv).post('/api/auth/signup').send(body).expect(202);
    await request(srv).post('/api/auth/signup').send(body).expect(202);
    await request(srv).post('/api/auth/signup').send(body).expect(202);

    const res = await request(srv).post('/api/auth/signup').send(body).expect(429);
    expect(res.headers['retry-after']).toBeTruthy();
  });

  it('allows up to 3 signin/request calls per email then blocks', async () => {
    const srv = app.getHttpServer() as Parameters<typeof request>[0];
    const body = { email: 'rl-email2@test.com' };

    await request(srv).post('/api/auth/signin/request').send(body).expect(202);
    await request(srv).post('/api/auth/signin/request').send(body).expect(202);
    await request(srv).post('/api/auth/signin/request').send(body).expect(202);

    const res = await request(srv)
      .post('/api/auth/signin/request')
      .send(body)
      .expect(429);
    expect(res.headers['retry-after']).toBeTruthy();
  });

  it('does not throttle a single request within the limit', async () => {
    const srv = app.getHttpServer() as Parameters<typeof request>[0];
    await request(srv)
      .post('/api/auth/signin/request')
      .send({ email: 'rl-control@test.com' })
      .expect(202);
  });
});

describe('Rate limiting — IP limit (e2e)', () => {
  let app: INestApplication<App>;

  // Fresh app — in-memory IP bucket starts at 0.
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it('allows 5 auth requests from one IP then blocks on the 6th', async () => {
    const srv = app.getHttpServer() as Parameters<typeof request>[0];

    for (let i = 1; i <= 5; i++) {
      await request(srv)
        .post('/api/auth/signin/request')
        .send({ email: `rl-ip-${String(i)}@test.com` })
        .expect(202);
    }

    const res = await request(srv)
      .post('/api/auth/signin/request')
      .send({ email: 'rl-ip-6@test.com' })
      .expect(429);
    expect(res.headers['retry-after']).toBeTruthy();
  });
});

describe('Rate limiting — consume limit (e2e)', () => {
  let app: INestApplication<App>;

  // Fresh app — consume bucket starts at 0.
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it('blocks consume after 3 attempts regardless of token validity', async () => {
    const srv = app.getHttpServer() as Parameters<typeof request>[0];

    // Three requests with invalid tokens — rate guard allows these through;
    // the handler returns 400 for each.
    await request(srv).get('/api/auth/signin?token=invalid1').expect(400);
    await request(srv).get('/api/auth/signin?token=invalid2').expect(400);
    await request(srv).get('/api/auth/signin?token=invalid3').expect(400);

    // Fourth request — rate guard fires before the handler.
    const res = await request(srv)
      .get('/api/auth/signin?token=invalid4')
      .expect(429);
    expect(res.headers['retry-after']).toBeTruthy();
  });
});
