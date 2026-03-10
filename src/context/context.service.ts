import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import { AgentsService } from '../agents/agents.service.js';
import type { AppConfig } from '../common/config/configuration.js';
import type { QueryContextDto } from './dto/query-context.dto.js';

@Injectable()
export class ContextService {
  private readonly logger = new Logger(ContextService.name);
  private readonly huckleberryAgentId: string;

  constructor(
    private readonly config: ConfigService,
    private readonly agents: AgentsService,
  ) {
    this.huckleberryAgentId =
      this.config.get<AppConfig>('app')!.huckleberryAgentId;
  }

  async queryStream(dto: QueryContextDto): Promise<Readable> {
    this.logger.log(`[queryStream] called with userInput="${dto.userInput?.slice(0, 80)}", sessionId=${dto.sessionId ?? 'none'}`);
    const stream = new Readable({ read() {} });

    this.executeAndPipe(stream, dto.userInput, dto.sessionId).catch((error) => {
      this.logger.error(`[queryStream] executeAndPipe threw: ${error}`);
      this.pushSSE(stream, {
        type: 'ERROR',
        message: error instanceof Error ? error.message : String(error),
      });
      stream.push(null);
    });

    return stream;
  }

  private async executeAndPipe(
    stream: Readable,
    userInput: string,
    sessionId?: string,
  ): Promise<void> {
    this.logger.log(`[executeAndPipe] calling agents.executeStream agentId=${this.huckleberryAgentId}`);
    const domoResponse = await this.agents.executeStream(
      this.huckleberryAgentId,
      { input: userInput, sessionId },
    );

    this.logger.log(`[executeAndPipe] domoResponse status=${domoResponse.status}, ok=${domoResponse.ok}, hasBody=${!!domoResponse.body}`);

    if (!domoResponse.ok) {
      const text = await domoResponse.text().catch(() => '');
      this.logger.warn(
        `Agent execution failed: ${domoResponse.status} ${text}`,
      );
      this.pushSSE(stream, {
        type: 'ERROR',
        message: `Agent execution failed: ${domoResponse.status} ${text}`,
      });
      stream.push(null);
      return;
    }

    if (!domoResponse.body) {
      this.pushSSE(stream, {
        type: 'ERROR',
        message: 'Agent returned no response body',
      });
      stream.push(null);
      return;
    }

    const reader = (
      domoResponse.body as import('node:stream/web').ReadableStream
    ).getReader();
    const decoder = new TextDecoder();

    let chunkCount = 0;
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const decoded = decoder.decode(value, { stream: true });
        chunkCount++;
        totalBytes += decoded.length;
        if (chunkCount <= 3) {
          this.logger.debug(`[executeAndPipe] chunk #${chunkCount} (${decoded.length} bytes): ${decoded.slice(0, 200)}`);
        }
        stream.push(decoded);
      }
    } finally {
      this.logger.log(`[executeAndPipe] stream complete — ${chunkCount} chunks, ${totalBytes} bytes total`);
      reader.releaseLock();
      stream.push(null);
    }
  }

  private pushSSE(stream: Readable, data: Record<string, unknown>): void {
    stream.push(`data: ${JSON.stringify(data)}\n\n`);
  }
}
