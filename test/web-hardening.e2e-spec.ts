/**
 * E2e tests for Phase 7 web hardening.
 *
 * Verifies:
 *   1. Security headers (helmet) are present on responses
 *   2. CORS headers respect the configured allowlist
 *   3. Swagger is gated behind NODE_ENV !== 'production'
 *
 * Run with:  pnpm test:e2e --testPathPatterns=web-hardening
 */

process.env.NODE_ENV = 'production';
process.env.PORT = '0';
process.env.SESSION_SIGNING_KEY =
  '0000000000000000000000000000000000000000000000000000000000000001';
process.env.ADMIN_API_KEY = 'test-admin-key';
process.env.MAGIC_LINK_BASE_URL = 'http://localhost:5173';
process.env.MAGIC_LINK_TTL_SECONDS = '900';
process.env.SESSION_TTL_SECONDS = '43200';
process.env.DEV_INSTANCE_ISSUER_URL = 'http://stub.test:443';
process.env.DEV_INSTANCE_CUSTOMER_ID = 'cust-a';
process.env.DEV_INSTANCE_OAUTH_CLIENT_ID = 'stub-client-id';
process.env.DEV_INSTANCE_OAUTH_CLIENT_SECRET = 'stub-client-secret';
process.env.DEV_INSTANCE_SCOPES = 'ai:read';
process.env.CORS_ORIGIN = 'https://app.huckleberry.ai';
process.env.DATABASE_URL =
  'mysql://huckleberry:huckleberry@localhost:3307/huckleberry';

import {
  type INestApplication,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { json } from 'express';
import helmet from 'helmet';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AppConfig } from '../src/common/config/configuration';
import { DomoExceptionFilter } from '../src/common/filters/domo-exception.filter';
import { ResponseEnvelopeInterceptor } from '../src/common/interceptors/response-envelope.interceptor';

async function buildApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.use(json({ limit: '10mb' }));

  app.use(
    helmet({
      hsts: { maxAge: 31_536_000, includeSubDomains: true },
      contentSecurityPolicy: {
        directives: { frameAncestors: ["'none'"] },
      },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  const config = app.get(ConfigService);
  const appConfig = config.getOrThrow<AppConfig>('app');
  const origins = appConfig.corsOrigin;
  app.enableCors({
    origin: origins.includes('*') ? true : origins,
    credentials: true,
  });

  app.setGlobalPrefix('api', {
    exclude: [{ path: 'health', method: RequestMethod.ALL }],
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

  if (appConfig.nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Huckleberry Server')
      .setVersion('0.1.0')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  await app.init();
  return app;
}

describe('Web hardening (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Security headers', () => {
    it('includes X-Content-Type-Options: nosniff', async () => {
      const srv = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(srv).get('/health').expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('includes Strict-Transport-Security with max-age', async () => {
      const srv = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(srv).get('/health').expect(200);
      expect(res.headers['strict-transport-security']).toContain(
        'max-age=31536000',
      );
      expect(res.headers['strict-transport-security']).toContain(
        'includeSubDomains',
      );
    });

    it('includes Content-Security-Policy with frame-ancestors none', async () => {
      const srv = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(srv).get('/health').expect(200);
      expect(res.headers['content-security-policy']).toContain(
        "frame-ancestors 'none'",
      );
    });

    it('includes Referrer-Policy', async () => {
      const srv = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(srv).get('/health').expect(200);
      expect(res.headers['referrer-policy']).toBe(
        'strict-origin-when-cross-origin',
      );
    });

    it('removes X-Powered-By header', async () => {
      const srv = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(srv).get('/health').expect(200);
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('CORS', () => {
    it('reflects Access-Control-Allow-Origin for allowed origin', async () => {
      const srv = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(srv)
        .options('/health')
        .set('Origin', 'https://app.huckleberry.ai')
        .set('Access-Control-Request-Method', 'GET');
      expect(res.headers['access-control-allow-origin']).toBe(
        'https://app.huckleberry.ai',
      );
    });

    it('does not reflect Access-Control-Allow-Origin for disallowed origin', async () => {
      const srv = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(srv)
        .options('/health')
        .set('Origin', 'https://evil.com')
        .set('Access-Control-Request-Method', 'GET');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('includes credentials support', async () => {
      const srv = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(srv)
        .options('/health')
        .set('Origin', 'https://app.huckleberry.ai')
        .set('Access-Control-Request-Method', 'GET');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('Swagger gating', () => {
    it('returns 404 for /docs in production', async () => {
      const srv = app.getHttpServer() as Parameters<typeof request>[0];
      await request(srv).get('/docs').expect(404);
    });

    it('returns 404 for /docs-json in production', async () => {
      const srv = app.getHttpServer() as Parameters<typeof request>[0];
      await request(srv).get('/docs-json').expect(404);
    });
  });
});
