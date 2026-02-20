import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { DomoProxyService } from './../src/domo-proxy/domo-proxy.service';
import { DomoExceptionFilter } from './../src/common/filters/domo-exception.filter';

// Ensure auth guard passes in test
process.env.DEV_TOKEN = 'test-token';
process.env.NODE_ENV = 'development';

describe('Agents (e2e)', () => {
  let app: INestApplication<App>;
  let mockDomo: Record<string, jest.Mock>;

  const testAgent = {
    id: 'agent-1',
    name: 'Test Agent',
    prompt: 'You are a test agent',
    systemMessage: 'Be helpful',
    toolkitIds: ['tk-1'],
  };

  beforeAll(async () => {
    mockDomo = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      postStream: jest.fn(),
    };

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DomoProxyService)
      .useValue(mockDomo)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new DomoExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /agents', () => {
    it('should create an agent', () => {
      mockDomo.post.mockResolvedValue(testAgent);

      return request(app.getHttpServer())
        .post('/agents')
        .send({ name: 'Test Agent', prompt: 'You are a test agent' })
        .expect(201)
        .expect((res) => {
          expect(res.body.id).toBe('agent-1');
          expect(res.body.name).toBe('Test Agent');
        });
    });

    it('should reject missing required fields', () => {
      return request(app.getHttpServer())
        .post('/agents')
        .send({ name: 'Test Agent' }) // missing prompt
        .expect(400);
    });

    it('should reject unknown fields', () => {
      return request(app.getHttpServer())
        .post('/agents')
        .send({ name: 'Test', prompt: 'Hello', bogus: true })
        .expect(400);
    });
  });

  describe('GET /agents/:agentId', () => {
    it('should return an agent', () => {
      mockDomo.get.mockResolvedValue(testAgent);

      return request(app.getHttpServer())
        .get('/agents/agent-1')
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe('agent-1');
        });
    });
  });

  describe('PUT /agents/:agentId', () => {
    it('should update an agent', () => {
      mockDomo.put.mockResolvedValue({ ...testAgent, name: 'Updated' });

      return request(app.getHttpServer())
        .put('/agents/agent-1')
        .send({ name: 'Updated' })
        .expect(200)
        .expect((res) => {
          expect(res.body.name).toBe('Updated');
        });
    });
  });

  describe('DELETE /agents/:agentId', () => {
    it('should delete an agent', () => {
      mockDomo.delete.mockResolvedValue(undefined);

      return request(app.getHttpServer()).delete('/agents/agent-1').expect(204);
    });
  });

  describe('POST /agents/search', () => {
    it('should search agents', () => {
      mockDomo.post.mockResolvedValue({
        agents: [testAgent],
        totalCount: 1,
        limit: 10,
        offset: 0,
      });

      return request(app.getHttpServer())
        .post('/agents/search')
        .send({ limit: 10, offset: 0 })
        .expect(200)
        .expect((res) => {
          expect(res.body.agents).toHaveLength(1);
        });
    });
  });

  describe('PATCH /agents/:agentId/context', () => {
    it('should update agent context', () => {
      mockDomo.put.mockResolvedValue({
        ...testAgent,
        context: { dataSourceIds: ['ds-1'] },
      });

      return request(app.getHttpServer())
        .patch('/agents/agent-1/context')
        .send({ add: { dataSourceIds: ['ds-1'] } })
        .expect(200)
        .expect((res) => {
          expect(res.body.context.dataSourceIds).toContain('ds-1');
        });
    });
  });

  describe('Error mapping', () => {
    it('should return 403 when Domo returns 403', async () => {
      const { DomoApiError } = await import(
        './../src/common/filters/domo-exception.filter'
      );
      mockDomo.post.mockRejectedValue(new DomoApiError(403, 'Access denied'));

      return request(app.getHttpServer())
        .post('/agents')
        .send({ name: 'Test', prompt: 'Hello' })
        .expect(403)
        .expect((res) => {
          expect(res.body.message).toBe('Access denied');
          expect(res.body.domoStatus).toBe(403);
        });
    });

    it('should return 409 when Domo returns 409', async () => {
      const { DomoApiError } = await import(
        './../src/common/filters/domo-exception.filter'
      );
      mockDomo.post.mockRejectedValue(new DomoApiError(409, 'Conflict'));

      return request(app.getHttpServer())
        .post('/agents')
        .send({ name: 'Test', prompt: 'Hello' })
        .expect(409);
    });
  });
});
