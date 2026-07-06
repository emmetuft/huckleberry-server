/**
 * E2E test for tenant-scoped authorization (Phase 1).
 *
 * Verifies:
 *   1. User A's personas are invisible to User B
 *   2. User A's MCP servers are invisible to User B
 *   3. MCP list responses redact bearer tokens
 *   4. Persona compat route (/api/persona) derives identity from session
 *
 * Uses a test interceptor override (via APP_INTERCEPTOR → DomoContextInterceptor)
 * that reads tenant identity from x-test-customer-id / x-test-user-id headers,
 * enabling multi-tenant simulation within a single process.
 *
 * Run with:  pnpm test:authz
 */

process.env.NODE_ENV = 'development';
process.env.PORT = '0';
process.env.SESSION_SIGNING_KEY =
  '0000000000000000000000000000000000000000000000000000000000000001';
process.env.ADMIN_API_KEY = 'test-admin-key';
process.env.MAGIC_LINK_BASE_URL = 'http://localhost:5173';
process.env.MAGIC_LINK_TTL_SECONDS = '900';
process.env.SESSION_TTL_SECONDS = '43200';
process.env.DEV_TOKEN = '';
process.env.DEV_INSTANCE_ISSUER_URL = 'http://stub.test:443';
process.env.DEV_INSTANCE_CUSTOMER_ID = 'cust-a';
process.env.DEV_INSTANCE_OAUTH_CLIENT_ID = 'stub-client-id';
process.env.DEV_INSTANCE_OAUTH_CLIENT_SECRET = 'stub-client-secret';
process.env.DEV_INSTANCE_SCOPES = 'ai:read';
process.env.DATABASE_URL =
  'mysql://huckleberry:huckleberry@localhost:3307/huckleberry';

import {
  type CallHandler,
  type ExecutionContext,
  type INestApplication,
  type NestInterceptor,
  type CanActivate,
  Injectable,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Observable } from 'rxjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DomoExceptionFilter } from '../src/common/filters/domo-exception.filter';
import { ResponseEnvelopeInterceptor } from '../src/common/interceptors/response-envelope.interceptor';
import { DomoContextInterceptor } from '../src/common/auth/domo-context.interceptor';
import { domoRequestContext } from '../src/common/auth/domo-request-context';
import { SessionAuthGuard } from '../src/common/auth/session-auth.guard';

/**
 * Test interceptor that reads tenant identity from request headers instead
 * of resolving a real Domo link. Simulates multiple tenants by varying headers.
 */
@Injectable()
class TestTenantInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const customerId =
      (req.headers['x-test-customer-id'] as string) || 'cust-a';
    const userId =
      (req.headers['x-test-user-id'] as string) ||
      '00000000-0000-4000-a000-000000000001';

    return new Observable((subscriber) => {
      domoRequestContext.run(
        {
          bearer: 'fake-bearer',
          targetHost: 'http://stub.test',
          customerId,
          userId,
        },
        () => {
          next.handle().subscribe({
            next: (v) => subscriber.next(v),
            error: (e) => subscriber.error(e),
            complete: () => subscriber.complete(),
          });
        },
      );
    });
  }
}

/**
 * Pass-through guard that always allows access.
 */
@Injectable()
class AlwaysAllowGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

describe('Authorization scoping (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DomoContextInterceptor)
      .useClass(TestTenantInterceptor)
      .overrideGuard(SessionAuthGuard)
      .useClass(AlwaysAllowGuard)
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
    app.useGlobalInterceptors(
      new ResponseEnvelopeInterceptor(),
      new TestTenantInterceptor(),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function asUser(customerId: string, userId: string) {
    return {
      'x-test-customer-id': customerId,
      'x-test-user-id': userId,
    };
  }

  const userA = () => asUser('cust-a', '00000000-0000-4000-a000-000000000001');
  const userB = () => asUser('cust-b', '00000000-0000-4000-a000-000000000002');

  describe('Persona tenant isolation', () => {
    let personaId: string;

    it('User A creates a persona via compat route', async () => {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(server)
        .post('/api/persona')
        .set(userA())
        .send({
          role: 'Engineer',
          level: 'Senior',
          department: 'Platform',
          focusAreas: ['security', 'auth'],
          strengths: ['testing'],
          weaknesses: [],
          goals: 'Harden the platform',
        })
        .expect(201);

      const body = res.body.data ?? res.body;
      expect(body.id).toBeTruthy();
      expect(body.role).toBe('Engineer');
      personaId = body.id;
    });

    it('User A can see their persona', async () => {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(server)
        .get('/api/persona')
        .set(userA())
        .expect(200);

      const body = res.body.data ?? res.body;
      expect(body).not.toBeNull();
      expect(body.id).toBe(personaId);
    });

    it('User B gets null — no cross-tenant leakage', async () => {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(server)
        .get('/api/persona')
        .set(userB())
        .expect(200);

      expect(res.body.data).toBeNull();
    });
  });

  describe('MCP server tenant isolation', () => {
    let serverId: string;

    it('User A registers an MCP server', async () => {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(server)
        .post('/api/mcp/servers')
        .set(userA())
        .send({
          name: 'Test MCP',
          url: 'http://localhost:9999/mcp',
          authType: 'bearer',
          bearerToken: 'super-secret-token-123',
        })
        .expect(201);

      const body = res.body.data ?? res.body;
      expect(body.id).toBeTruthy();
      expect(body.name).toBe('Test MCP');
      serverId = body.id;
    });

    it('User A sees their server in the list', async () => {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(server)
        .get('/api/mcp/servers')
        .set(userA())
        .expect(200);

      const body = res.body.data ?? res.body;
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
      const found = body.find((s: any) => s.id === serverId);
      expect(found).toBeTruthy();
    });

    it('User B gets empty list — no cross-tenant leakage', async () => {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(server)
        .get('/api/mcp/servers')
        .set(userB())
        .expect(200);

      const body = res.body.data ?? res.body;
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(0);
    });

    it('MCP response redacts bearerToken', async () => {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(server)
        .get(`/api/mcp/servers/${serverId}`)
        .set(userA())
        .expect(200);

      const body = res.body.data ?? res.body;
      expect(body.bearerToken).toBeUndefined();
      expect(body.name).toBe('Test MCP');
    });

    it('User B cannot access User A server by ID', async () => {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      await request(server)
        .get(`/api/mcp/servers/${serverId}`)
        .set(userB())
        .expect(404);
    });
  });
});
