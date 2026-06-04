import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import type { Response as ExpressResponse } from 'express';
import { AgentsService } from '../agents/agents.service.js';
import type { AppConfig } from '../common/config/configuration.js';
import { AgentType } from '../common/types/domo-common.types.js';
import { HttpHeader } from '../common/constants/http.constants.js';
import { DomoApiError } from '../common/filters/domo-exception.filter.js';
import type { ExecuteAgentDto } from '../agents/dto/execute-agent.dto.js';
import type { ResumeAgentDto } from '../agents/dto/resume-agent.dto.js';

/** Headers managed by Node/Express that must not be copied from upstream. */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'content-encoding',
  'host',
  'te',
  'trailer',
  'upgrade',
]);

@Injectable()
export class HuckleberryService {
  private readonly huckleberryAgentId: string;
  private readonly logger = new Logger(HuckleberryService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly agents: AgentsService,
  ) {
    this.huckleberryAgentId =
      this.config.get<AppConfig>('app')?.huckleberryAgentId ?? 'huckleberry';
  }

  async executeStream(
    dto: ExecuteAgentDto,
    res: ExpressResponse,
  ): Promise<void> {
    const agentId = this.resolveAgentId();
    const domoResponse = await this.agents.executeStream(agentId, {
      ...dto,
      agentType: AgentType.TOOL_CALLING,
    });
    return this.pipeStreamResponse(domoResponse, res);
  }

  async resumeStream(dto: ResumeAgentDto, res: ExpressResponse): Promise<void> {
    const agentId = this.resolveAgentId();
    const domoResponse = await this.agents.resumeStream(agentId, {
      ...dto,
      batchConfirmationId: dto.batchId,
      agentStrategy: AgentType.TOOL_CALLING,
    });
    return this.pipeStreamResponse(domoResponse, res);
  }

  private resolveAgentId(): string {
    if (!this.huckleberryAgentId) {
      throw new NotFoundException(
        'Huckleberry agent ID is not configured. Set the HUCKLEBERRY_AGENT_ID environment variable.',
      );
    }
    return this.huckleberryAgentId;
  }

  private async pipeStreamResponse(
    domoResponse: Response,
    res: ExpressResponse,
  ): Promise<void> {
    if (!domoResponse.ok) {
      const text = await domoResponse.text().catch(() => '');
      throw new DomoApiError(
        domoResponse.status,
        text || domoResponse.statusText,
        domoResponse.headers.get(HttpHeader.ContentType),
      );
    }

    if (!domoResponse.body) {
      throw new DomoApiError(502, 'Upstream returned no response body');
    }

    res.status(domoResponse.status);
    domoResponse.headers.forEach((value, key) => {
      if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    const readable = Readable.fromWeb(
      domoResponse.body as import('node:stream/web').ReadableStream,
    );

    const decoder = new TextDecoder();
    readable.on('data', (chunk: Buffer) => {
      this.logger.debug(decoder.decode(chunk, { stream: true }));
    });

    await new Promise<void>((resolve, reject) => {
      readable.on('error', (err) => {
        if (!res.headersSent) {
          reject(
            new DomoApiError(502, `Upstream stream error: ${String(err)}`),
          );
        } else {
          res.end();
          resolve();
        }
      });
      readable.pipe(res).on('finish', resolve);
    });
  }
}
