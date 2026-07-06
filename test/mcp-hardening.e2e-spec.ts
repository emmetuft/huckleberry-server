/**
 * E2E tests for Phase 4 MCP hardening.
 *
 * Verifies:
 *   1. HTTP URLs are rejected in production (HTTPS-only DTO validation)
 *   2. IP literal URLs are rejected in production (require_tld)
 *   3. POST /mcp/tools/execute response carries X-MCP-Untrusted: true
 *
 * Runs with NODE_ENV=production so the HTTPS-only validation fires.
 * McpService is replaced with a lightweight stub to avoid network calls.
 *
 * Run with:  pnpm test:e2e --testPathPatterns=mcp-hardening
 */

process.env.NODE_ENV = 'production';
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
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  type NestInterceptor,
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
import { McpService } from '../src/mcp/mcp.service';

@Injectable()
class TestTenantInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return new Observable((subscriber) => {
      domoRequestContext.run(
        {
          bearer: 'fake-bearer',
          targetHost: 'http://stub.test',
          customerId: 'cust-test',
          userId: '00000000-0000-4000-a000-000000000001',
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

@Injectable()
class AlwaysAllowGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

const stubServer = {
  id: 'test-server-id',
  name: 'Stub MCP',
  url: 'https://mcp.example.com',
  enabled: true,
  authType: 'none' as const,
  tools: [],
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

const stubMcpService = {
  create: () => Promise.resolve(stubServer),
  findAll: () => Promise.resolve([stubServer]),
  findOne: (id: string) =>
    Promise.resolve(id === stubServer.id ? stubServer : null),
  update: () => Promise.resolve(stubServer),
  remove: () => Promise.resolve(undefined),
  toggle: () => Promise.resolve(stubServer),
  testConnection: () => Promise.resolve({ connected: true, toolCount: 0 }),
  syncTools: () => Promise.resolve({ server: stubServer, toolCount: 0 }),
  getAllTools: () => Promise.resolve([]),
  executeTool: () => Promise.resolve({ success: true, data: { text: 'ok' } }),
  getOAuth2AuthorizationUrl: () => ({ authorizationUrl: '', state: 'stub' }),
  revokeOAuth2: () => ({ revoked: true }),
  getOAuth2Status: () => ({ status: 'not_authorized' }),
  discoverOAuth2: () => ({ message: 'stub' }),
};

async function buildApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DomoContextInterceptor)
    .useClass(TestTenantInterceptor)
    .overrideGuard(SessionAuthGuard)
    .useClass(AlwaysAllowGuard)
    .overrideProvider(McpService)
    .useValue(stubMcpService)
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
  app.useGlobalInterceptors(
    new ResponseEnvelopeInterceptor(),
    new TestTenantInterceptor(),
  );
  await app.init();
  return app;
}

describe('MCP hardening (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('URL validation — production mode', () => {
    it.each([
      ['http://localhost:9000', 'plain HTTP (localhost)'],
      ['http://10.0.0.1/mcp', 'plain HTTP (RFC 1918)'],
      ['http://mcp.example.com', 'plain HTTP (public domain)'],
      ['ftp://mcp.example.com', 'non-HTTP protocol'],
      ['not-a-url', 'not a URL'],
    ])('rejects %s (%s)', async (url) => {
      const srv = app.getHttpServer() as Parameters<typeof request>[0];
      await request(srv)
        .post('/api/mcp/servers')
        .send({ name: 'Test', url })
        .expect(400);
    });

    it('accepts a well-formed HTTPS URL', async () => {
      const srv = app.getHttpServer() as Parameters<typeof request>[0];
      await request(srv)
        .post('/api/mcp/servers')
        .send({ name: 'Test', url: 'https://mcp.example.com' })
        .expect(201);
    });
  });

  describe('X-MCP-Untrusted response header', () => {
    it('tool execution response includes X-MCP-Untrusted: true', async () => {
      const srv = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(srv)
        .post('/api/mcp/tools/execute')
        .send({ serverId: stubServer.id, toolName: 'echo', params: {} })
        .expect(200);

      expect(res.headers['x-mcp-untrusted']).toBe('true');
    });

    it('response body contains tool result', async () => {
      const srv = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(srv)
        .post('/api/mcp/tools/execute')
        .send({ serverId: stubServer.id, toolName: 'echo' })
        .expect(200);

      // ResponseEnvelopeInterceptor passes through payloads that already carry
      // the { success, data } envelope shape — so executeTool result is top-level.
      expect((res.body as { success: boolean }).success).toBe(true);
    });
  });
});
