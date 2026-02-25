import { Test, TestingModule } from '@nestjs/testing';
import { AiServicesService } from './ai-services.service';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service';

describe('AiServicesService', () => {
  let service: AiServicesService;
  let domo: jest.Mocked<DomoProxyService>;

  beforeEach(async () => {
    const mockDomo = {
      post: jest.fn(),
      postStream: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiServicesService,
        { provide: DomoProxyService, useValue: mockDomo },
      ],
    }).compile();

    service = module.get<AiServicesService>(AiServicesService);
    domo = module.get(DomoProxyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generate', () => {
    it('should POST to generation endpoint', async () => {
      const dto = { input: 'hello' };
      const expected = { id: '1', choices: [] };
      domo.post.mockResolvedValue(expected);

      const result = await service.generate(dto);

      expect(result).toEqual(expected);
      expect(domo.post).toHaveBeenCalledWith('/api/ai/v1/text/generation', dto);
    });
  });

  describe('chat', () => {
    it('should POST to chat endpoint', async () => {
      const dto = { input: 'hello' };
      const expected = { id: '1', choices: [] };
      domo.post.mockResolvedValue(expected);

      const result = await service.chat(dto);

      expect(result).toEqual(expected);
      expect(domo.post).toHaveBeenCalledWith('/api/ai/v1/text/chat', dto);
    });
  });

  describe('chatStream', () => {
    it('should call postStream for streaming chat', async () => {
      const dto = { input: 'hello' };
      const mockResponse = { body: 'stream' } as unknown as Response;
      domo.postStream.mockResolvedValue(mockResponse);

      const result = await service.chatStream(dto);

      expect(result).toBe(mockResponse);
      expect(domo.postStream).toHaveBeenCalledWith(
        '/api/ai/v1/text/chat/streaming',
        dto,
      );
    });
  });

  describe('summarize', () => {
    it('should POST to summarize endpoint', async () => {
      const dto = { input: 'long text' };
      const expected = { id: '1', choices: [] };
      domo.post.mockResolvedValue(expected);

      const result = await service.summarize(dto);

      expect(result).toEqual(expected);
      expect(domo.post).toHaveBeenCalledWith('/api/ai/v1/text/summarize', dto);
    });
  });

  describe('textToSql', () => {
    it('should POST to sql endpoint', async () => {
      const dto = { input: 'get all users' };
      const expected = { id: '1', choices: [] };
      domo.post.mockResolvedValue(expected);

      const result = await service.textToSql(dto);

      expect(result).toEqual(expected);
      expect(domo.post).toHaveBeenCalledWith('/api/ai/v1/text/sql', dto);
    });
  });

  describe('textToBeastMode', () => {
    it('should POST to beastmode endpoint', async () => {
      const dto = { input: 'calculate revenue' };
      const expected = { id: '1', choices: [] };
      domo.post.mockResolvedValue(expected);

      const result = await service.textToBeastMode(dto);

      expect(result).toEqual(expected);
      expect(domo.post).toHaveBeenCalledWith('/api/ai/v1/text/beastmode', dto);
    });
  });
});
