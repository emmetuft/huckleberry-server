import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiServicesController } from './ai-services.controller';
import { AiServicesService } from './ai-services.service';
import { DomoApiError } from '../common/filters/domo-exception.filter';
import { Response as ExpressResponse } from 'express';
import { Readable } from 'node:stream';
import { TextGenerationDto } from './dto/text-generation.dto';
import { ChatCompletionDto } from './dto/chat-completion.dto';
import { TextSummarizationDto } from './dto/text-summarization.dto';
import { TextToSqlDto } from './dto/text-to-sql.dto';
import { TextToBeastModeDto } from './dto/text-to-beastmode.dto';

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
              devToken: 'test-token',
            }),
          },
        },
      ],
    }).compile();

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

  it('should chat', async () => {
    const dto = { input: 'hello' } as ChatCompletionDto;
    const expected = { id: '1', choices: [] };
    service.chat.mockResolvedValue(expected);

    const result = await controller.chat(dto);
    expect(result).toEqual(expected);
    expect(service.chat).toHaveBeenCalledWith(dto);
  });

  it('should stream chat with correct headers and piping', async () => {
    const dto = { input: 'hello' } as ChatCompletionDto;
    const mockReadable = new Readable({ read() {} });
    const mockBody = {
      getReader: jest.fn(),
      [Symbol.asyncIterator]: jest.fn(),
    };
    const mockHeaders = new Headers({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const mockResponse = {
      ok: true,
      body: mockBody,
      status: 200,
      headers: mockHeaders,
    } as unknown as Response;
    service.chatStream.mockResolvedValue(mockResponse);

    const res = {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
    } as unknown as ExpressResponse;

    // Mock Readable.fromWeb to return our controlled readable
    const fromWebSpy = jest
      .spyOn(Readable, 'fromWeb')
      .mockReturnValue(mockReadable);
    mockReadable.pipe = jest.fn().mockReturnValue(mockReadable);

    await controller.chatStream(dto, res);

    expect(service.chatStream).toHaveBeenCalledWith(dto);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith(
      'content-type',
      'text/event-stream',
    );
    expect(res.setHeader).toHaveBeenCalledWith('cache-control', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('connection', 'keep-alive');
    expect(fromWebSpy).toHaveBeenCalledWith(mockBody);
    expect(mockReadable.pipe).toHaveBeenCalledWith(res);

    fromWebSpy.mockRestore();
  });

  it('should throw DomoApiError when chat stream returns non-2xx', async () => {
    const dto = { input: 'hello' } as ChatCompletionDto;
    const mockHeaders = new Headers({
      'content-type': 'application/json',
    });
    const mockResponse = {
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      headers: mockHeaders,
      text: jest.fn().mockResolvedValue('upstream error'),
    } as unknown as Response;
    service.chatStream.mockResolvedValue(mockResponse);

    const res = {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
    } as unknown as ExpressResponse;

    await expect(controller.chatStream(dto, res)).rejects.toThrow(DomoApiError);
    await expect(controller.chatStream(dto, res)).rejects.toMatchObject({
      statusCode: 502,
      message: 'upstream error',
    });
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

  it('should convert text to BeastMode', async () => {
    const dto = { input: 'calculate revenue' } as TextToBeastModeDto;
    const expected = { id: '1', choices: [] };
    service.textToBeastMode.mockResolvedValue(expected);

    const result = await controller.textToBeastMode(dto);
    expect(result).toEqual(expected);
    expect(service.textToBeastMode).toHaveBeenCalledWith(dto);
  });
});
