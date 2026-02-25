import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { DomoProxyService } from './../src/domo-proxy/domo-proxy.service';

// Ensure auth guard passes in test
process.env.DEV_TOKEN = 'test-token';
process.env.NODE_ENV = 'development';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DomoProxyService)
      .useValue({
        get: jest.fn(),
        post: jest.fn().mockResolvedValue({ agents: [], totalCount: 0, limit: 1000, offset: 0 }),
        put: jest.fn(),
        delete: jest.fn(),
        postStream: jest.fn(),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });
});
