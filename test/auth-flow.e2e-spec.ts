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
process.env.MAGIC_LINK_BASE_URL = 'http://localhost:3000';
process.env.MAGIC_LINK_TTL_SECONDS = '900';
process.env.SESSION_TTL_SECONDS = '43200';

import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
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
  async sendMagicLink(email: MagicLinkEmail): Promise<void> {
    this.lastEmail = email;
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
    const server = app.getHttpServer();

    // 1. Seed a user.
    const onboard = await request(server)
      .post('/api/admin/users')
      .set('x-admin-api-key', 'test-admin-key')
      .send({
        email: 'e2e@huckleberry.com',
        issuerUrl: 'http://domo-labs-dev.dev.domo.com:443',
        customerId: 'labs',
      })
      .expect(201);
    expect(onboard.body.data.userId).toBeTruthy();

    // 2. Magic-link captured.
    expect(emails.lastEmail).not.toBeNull();
    expect(emails.lastEmail!.to).toBe('e2e@huckleberry.com');
    const url = new URL(emails.lastEmail!.url);
    expect(url.pathname).toBe('/api/auth/signin');
    const token = url.searchParams.get('token');
    expect(token).toBeTruthy();

    // 3. Consume the magic link — should set hb_session + csrf_token cookies.
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
    expect(consume.body.data.needsLinkage).toBe(true);

    const cookieHeader = cookies
      .map((c) => c.split(';')[0])
      .join('; ');
    const csrfToken = csrfCookie!.split(';')[0].split('=')[1];

    // 4. Use the session.
    const me = await request(server)
      .get('/api/auth/me')
      .set('Cookie', cookieHeader)
      .expect(200);
    expect(me.body.data.email).toBe('e2e@huckleberry.com');
    expect(me.body.data.status).toBe('pending_link');

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
    const server = app.getHttpServer();
    await request(server)
      .post('/api/admin/users')
      .send({
        email: 'rogue@huckleberry.com',
        issuerUrl: 'http://domo-labs-dev.dev.domo.com:443',
        customerId: 'labs',
      })
      .expect(403);
  });

  it('signin/request 202s for unknown emails (no account leak)', async () => {
    const server = app.getHttpServer();
    const before = emails.lastEmail;
    await request(server)
      .post('/api/auth/signin/request')
      .send({ email: 'never-seeded@huckleberry.com' })
      .expect(202);
    // No new email captured for the unknown address.
    expect(emails.lastEmail).toBe(before);
  });

  it('rejects CSRF mismatch on state-changing routes', async () => {
    const server = app.getHttpServer();

    // Seed + consume to get a valid session.
    await request(server)
      .post('/api/admin/users')
      .set('x-admin-api-key', 'test-admin-key')
      .send({
        email: 'csrf@huckleberry.com',
        issuerUrl: 'http://domo-labs-dev.dev.domo.com:443',
        customerId: 'labs',
      })
      .expect(201);
    const token = new URL(emails.lastEmail!.url).searchParams.get('token')!;
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
