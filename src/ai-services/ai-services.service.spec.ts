import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { AiServicesService } from './ai-services.service';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service';

describe('AiServicesService', () => {
  let service: AiServicesService;
  let domo: jest.Mocked<DomoProxyService>;

  beforeEach(async () => {
    const mockDomo = {
      post: jest.fn(),
      get: jest.fn(),
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

  describe('imageToText', () => {
    it('should POST to image text endpoint', async () => {
      const dto = { image: 'base64data' };
      const expected = { id: '1', choices: [] };
      domo.post.mockResolvedValue(expected);

      const result = await service.imageToText(dto);

      expect(result).toEqual(expected);
      expect(domo.post).toHaveBeenCalledWith('/api/ai/v1/image/text', dto);
    });
  });

  describe('getModels', () => {
    it('should GET models endpoint', async () => {
      const expected = { models: [] };
      domo.get.mockResolvedValue(expected);

      const result = await service.getModels();

      expect(result).toEqual(expected);
      expect(domo.get).toHaveBeenCalledWith(
        '/api/ai/v1/settings/services/messages/models',
      );
    });
  });
});
