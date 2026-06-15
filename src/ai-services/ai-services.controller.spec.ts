import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiServicesController } from './ai-services.controller';
import { AiServicesService } from './ai-services.service';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard';
import { TextGenerationDto } from './dto/text-generation.dto';
import { TextSummarizationDto } from './dto/text-summarization.dto';
import { TextToSqlDto } from './dto/text-to-sql.dto';

describe('AiServicesController', () => {
  let controller: AiServicesController;
  let service: jest.Mocked<AiServicesService>;

  beforeEach(async () => {
    const mockService = {
      generate: jest.fn(),
      chat: jest.fn(),
      chatStream: jest.fn(),
      summarize: jest.fn(),
      textToSql: jest.fn(),
      textToBeastMode: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiServicesController],
      providers: [
        { provide: AiServicesService, useValue: mockService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue({
              nodeEnv: 'development',
            }),
          },
        },
      ],
    })
      .overrideGuard(DomoAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AiServicesController>(AiServicesController);
    service = module.get(AiServicesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should generate text', async () => {
    const dto = { input: 'hello' } as TextGenerationDto;
    const expected = { id: '1', choices: [] };
    service.generate.mockResolvedValue(expected);

    const result = await controller.generate(dto);
    expect(result).toEqual(expected);
    expect(service.generate).toHaveBeenCalledWith(dto);
  });

  it('should summarize text', async () => {
    const dto = { input: 'long text' } as TextSummarizationDto;
    const expected = { id: '1', choices: [] };
    service.summarize.mockResolvedValue(expected);

    const result = await controller.summarize(dto);
    expect(result).toEqual(expected);
    expect(service.summarize).toHaveBeenCalledWith(dto);
  });

  it('should convert text to SQL', async () => {
    const dto = { input: 'get all users' } as TextToSqlDto;
    const expected = { id: '1', choices: [] };
    service.textToSql.mockResolvedValue(expected);

    const result = await controller.textToSql(dto);
    expect(result).toEqual(expected);
    expect(service.textToSql).toHaveBeenCalledWith(dto);
  });
});
