import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DomoProxyService } from './domo-proxy.service';
import { DomoApiError } from '../common/filters/domo-exception.filter';

describe('DomoProxyService', () => {
  let service: DomoProxyService;

  const mockConfig = {
    get: jest.fn().mockReturnValue({
      domoInstanceUrl: 'https://test.domo.com',
      devToken: 'test-token',
      nodeEnv: 'development',
      port: 3000,
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DomoProxyService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<DomoProxyService>(DomoProxyService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should make a GET request with auth header', async () => {
    const mockResponse = { id: '123', name: 'Test Agent' };
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const result = await service.get('/api/ai/v1/agents/123');

    expect(result).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      'https://test.domo.com/api/ai/v1/agents/123',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'X-DOMO-Developer-Token': 'test-token',
        }),
      }),
    );
  });

  it('should make a POST request with body', async () => {
    const body = { name: 'New Agent', prompt: 'Do things' };
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ id: '456', ...body }),
    } as Response);

    const result = await service.post('/api/ai/v1/agents', body);

    expect(result).toEqual({ id: '456', ...body });
    expect(fetch).toHaveBeenCalledWith(
      'https://test.domo.com/api/ai/v1/agents',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );
  });

  it('should throw DomoApiError on non-ok response', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: () => Promise.resolve('Access denied'),
    } as Response);

    await expect(service.get('/api/ai/v1/agents/123')).rejects.toThrow(
      DomoApiError,
    );
  });

  it('should append query params', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({}),
    } as Response);

    await service.get('/api/ai/v1/agents/123', {
      query: { include: 'all' },
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://test.domo.com/api/ai/v1/agents/123?include=all',
      expect.anything(),
    );
  });
});
