/**
 * End-to-end smoke test for Layer A — magic-link sign-in.
 *
 * Boots the full Nest app (with the `/api` global prefix and pipes/filters
 * applied) and walks the entire flow programmatically:
 *
 *   1. Seed a user via POST /api/admin/users
 *   2. Capture the magic-link URL from a stub EmailService
 *   3. GET the magic-link URL — assert hb_session + csrf_token Set-Cookie
 *   4. GET /api/auth/me — assert the principal comes back
 *   5. POST /api/auth/logout — assert cookies cleared + session revoked
 *   6. GET /api/auth/me — assert 401
 *
 * Run with:  pnpm test:auth
 *
 * Sets its own env so it doesn't need .env values present.
 */

// Set required env BEFORE module imports so configuration() picks them up.
process.env.NODE_ENV = 'development';
process.env.PORT = '0';
process.env.SESSION_SIGNING_KEY =
  '0000000000000000000000000000000000000000000000000000000000000001';
process.env.ADMIN_API_KEY = 'test-admin-key';
process.env.MAGIC_LINK_BASE_URL = 'http://localhost:5173';
process.env.MAGIC_LINK_TTL_SECONDS = '900';
process.env.SESSION_TTL_SECONDS = '43200';
// Stub instance-provisioner config — values are not actually used by the
// e2e because no real Gatekeeper call fires in these tests; they just need
// to be non-empty so the provisioner doesn't throw ServiceUnavailable.
process.env.DEV_INSTANCE_ISSUER_URL = 'http://stub.test:443';
process.env.DEV_INSTANCE_CUSTOMER_ID = 'stub';
process.env.DEV_INSTANCE_OAUTH_CLIENT_ID = 'stub-client-id';
process.env.DEV_INSTANCE_OAUTH_CLIENT_SECRET = 'stub-client-secret';
process.env.DEV_INSTANCE_SCOPES = 'ai:read';

import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DomoExceptionFilter } from '../src/common/filters/domo-exception.filter';
import { ResponseEnvelopeInterceptor } from '../src/common/interceptors/response-envelope.interceptor';
import {
  EMAIL_SERVICE,
  type EmailService,
  type MagicLinkEmail,
} from '../src/auth/email.service';

class CapturingEmailService implements EmailService {
  public lastEmail: MagicLinkEmail | null = null;
  sendMagicLink(email: MagicLinkEmail): Promise<void> {
    this.lastEmail = email;
    return Promise.resolve();
  }
}

describe('Auth flow (e2e)', () => {
  let app: INestApplication;
  let emails: CapturingEmailService;

  beforeAll(async () => {
    emails = new CapturingEmailService();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EMAIL_SERVICE)
      .useValue(emails)
      .compile();

    app = moduleRef.createNestApplication();
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
  });

  afterAll(async () => {
    await app.close();
  });

  it('walks the magic-link flow end-to-end', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    // 1. Seed a user.
    const onboard = await request(server)
      .post('/api/admin/users')
      .set('x-admin-api-key', 'test-admin-key')
      .send({
        email: 'e2e@huckleberry.ai',
      })
      .expect(201);
    expect(onboard.body.data.userId).toBeTruthy();

    // 2. Magic-link captured.
    expect(emails.lastEmail).not.toBeNull();
    expect(emails.lastEmail.to).toBe('e2e@huckleberry.ai');
    const url = new URL(emails.lastEmail.url);
    expect(url.origin).toBe('http://localhost:5173');
    expect(url.pathname).toBe('/auth/signin');
    const token = url.searchParams.get('token');
    expect(token).toBeTruthy();

    // 3. Simulate the SPA's consume call — POST/GET to the BFF endpoint
    //    that the SPA's /auth/signin page invokes via fetch.
    const consume = await request(server)
      .get(`/api/auth/signin?token=${token}`)
      .expect(200);
    const cookies = consume.headers['set-cookie'] as unknown as string[];
    expect(cookies).toBeDefined();
    const sessionCookie = cookies.find((c) => c.startsWith('hb_session='));
    const csrfCookie = cookies.find((c) => c.startsWith('csrf_token='));
    expect(sessionCookie).toBeTruthy();
    expect(csrfCookie).toBeTruthy();
    expect(sessionCookie).toMatch(/HttpOnly/);
    // Operator onboarding via /admin/users bootstraps a client_credentials
    // link and flips the user to status='active' in one shot — no
    // pending_link / no browser-side OAuth dance.
    expect(consume.body.data.needsLinkage).toBe(false);

    const cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ');
    const csrfToken = csrfCookie.split(';')[0].split('=')[1];

    // 4. Use the session.
    const me = await request(server)
      .get('/api/auth/me')
      .set('Cookie', cookieHeader)
      .expect(200);
    expect(me.body.data.email).toBe('e2e@huckleberry.ai');
    expect(me.body.data.status).toBe('active');

    // 5. Reject reuse of the same magic-link token.
    await request(server).get(`/api/auth/signin?token=${token}`).expect(400);

    // 6. Logout — needs CSRF token (state-changing).
    await request(server)
      .post('/api/auth/logout')
      .set('Cookie', cookieHeader)
      .set('x-csrf-token', csrfToken)
      .expect(204);

    // 7. Session is now revoked.
    await request(server)
      .get('/api/auth/me')
      .set('Cookie', cookieHeader)
      .expect(401);
  });

  it('rejects admin endpoint without the API key', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    await request(server)
      .post('/api/admin/users')
      .send({
        email: 'rogue@huckleberry.ai',
      })
      .expect(403);
  });

  it('signin/request auto-provisions a new user (freemium signup)', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    await request(server)
      .post('/api/auth/signin/request')
      .send({ email: 'fresh-signup@huckleberry.ai' })
      .expect(202);
    // The signin/request endpoint find-or-creates the user and emails a
    // magic-link in both branches — freemium-style. The new user now has
    // a linked instance via the stub provisioner.
    expect(emails.lastEmail?.to).toBe('fresh-signup@huckleberry.ai');
  });

  it('rejects CSRF mismatch on state-changing routes', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    // Seed + consume to get a valid session.
    await request(server)
      .post('/api/admin/users')
      .set('x-admin-api-key', 'test-admin-key')
      .send({
        email: 'csrf@huckleberry.ai',
      })
      .expect(201);
    const token = new URL(emails.lastEmail.url).searchParams.get('token');
    const consume = await request(server)
      .get(`/api/auth/signin?token=${token}`)
      .expect(200);
    const cookies = consume.headers['set-cookie'] as unknown as string[];
    const cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ');

    // Logout without the X-CSRF-Token header → 401.
    await request(server)
      .post('/api/auth/logout')
      .set('Cookie', cookieHeader)
      .expect(401);
  });
});
