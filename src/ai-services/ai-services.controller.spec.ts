import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiServicesController } from './ai-services.controller';
import { AiServicesService } from './ai-services.service';
import { Response as ExpressResponse } from 'express';
import { Readable } from 'node:stream';

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
    const dto = { input: 'hello' };
    const expected = { id: '1', choices: [] };
    service.generate.mockResolvedValue(expected);

    const result = await controller.generate(dto as any);
    expect(result).toEqual(expected);
    expect(service.generate).toHaveBeenCalledWith(dto);
  });

  it('should chat', async () => {
    const dto = { input: 'hello' };
    const expected = { id: '1', choices: [] };
    service.chat.mockResolvedValue(expected);

    const result = await controller.chat(dto as any);
    expect(result).toEqual(expected);
    expect(service.chat).toHaveBeenCalledWith(dto);
  });

  it('should stream chat with correct headers and piping', async () => {
    const dto = { input: 'hello' };
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

    await controller.chatStream(dto as any, res);

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

  it('should summarize text', async () => {
    const dto = { input: 'long text' };
    const expected = { id: '1', choices: [] };
    service.summarize.mockResolvedValue(expected);

    const result = await controller.summarize(dto as any);
    expect(result).toEqual(expected);
    expect(service.summarize).toHaveBeenCalledWith(dto);
  });

  it('should convert text to SQL', async () => {
    const dto = { input: 'get all users' };
    const expected = { id: '1', choices: [] };
    service.textToSql.mockResolvedValue(expected);

    const result = await controller.textToSql(dto as any);
    expect(result).toEqual(expected);
    expect(service.textToSql).toHaveBeenCalledWith(dto);
  });

  it('should convert text to BeastMode', async () => {
    const dto = { input: 'calculate revenue' };
    const expected = { id: '1', choices: [] };
    service.textToBeastMode.mockResolvedValue(expected);

    const result = await controller.textToBeastMode(dto as any);
    expect(result).toEqual(expected);
    expect(service.textToBeastMode).toHaveBeenCalledWith(dto);
  });
});
