import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import { Neo4jService } from '../ontology/neo4j.service.js';
import { PersonasService } from '../personas/personas.service.js';
import { AgentsService } from '../agents/agents.service.js';
import { classifyIntent } from './intent-classifier.js';
import type { AppConfig } from '../common/config/configuration.js';
import {
  IntentClass,
  StreamType,
  type GraphContext,
  type StreamMessage,
} from '../common/types/context.types.js';
import type { Persona } from '../common/types/persona.types.js';
import type { QueryContextDto } from './dto/query-context.dto.js';

@Injectable()
export class ContextService {
  private readonly logger = new Logger(ContextService.name);
  private readonly huckleberryAgentId: string;

  constructor(
    private readonly config: ConfigService,
    private readonly neo4j: Neo4jService,
    private readonly personas: PersonasService,
    private readonly agents: AgentsService,
  ) {
    this.huckleberryAgentId =
      this.config.get<AppConfig>('app')!.huckleberryAgentId;
  }

  /**
   * Assemble context for a query without executing the agent.
   * Returns the assembled GraphContext snapshot.
   */
  async assembleContext(dto: QueryContextDto): Promise<GraphContext> {
    const intent = classifyIntent(dto.input);
    this.logger.log(`Intent classified as: ${intent}`);

    // Load persona
    let persona: Persona | undefined;
    if (dto.personaId) {
      try {
        persona = this.personas.findOne(dto.personaId);
      } catch {
        this.logger.warn(`Persona ${dto.personaId} not found, using default`);
      }
    }
    if (!persona) {
      persona = this.personas.findDefault();
    }

    // Search ontology for relevant entities
    let entities: GraphContext['entities'] = [];
    let relationships: GraphContext['relationships'] = [];
    try {
      const graphData = await this.neo4j.searchNodes(dto.input, 50);
      entities = graphData.nodes.map((n) => ({
        id: n.id,
        label: n.labels[0] ?? 'Unknown',
        name: (n.properties.name as string) ?? n.labels[0] ?? n.id,
        properties: n.properties,
      }));
      relationships = graphData.relationships.map((r) => ({
        from: r.startNodeId,
        to: r.endNodeId,
        type: r.type,
      }));
    } catch (error) {
      this.logger.warn(`Ontology search failed: ${String(error)}`);
    }

    const context: GraphContext = {
      entities,
      relationships,
      intent,
      ...(persona &&
        persona.usePersona && {
          persona: {
            role: persona.role,
            department: persona.department,
            focusAreas: persona.focusAreas,
            goals: persona.goals,
          },
        }),
    };

    return context;
  }

  /**
   * Assemble context, execute the Huckleberry agent, and return
   * a readable stream that emits SSE-formatted StreamMessage events.
   */
  async queryStream(dto: QueryContextDto): Promise<Readable> {
    const context = await this.assembleContext(dto);

    // Build the enriched input with context blocks
    const enrichedInput = this.buildEnrichedInput(dto.input, context);

    const stream = new Readable({ read() {} });

    // Emit the context event first
    this.pushSSE(stream, {
      type: StreamType.CONTEXT,
      context,
      message: 'Context assembled',
    });

    // Execute the Huckleberry agent with the enriched input
    this.executeAndPipe(stream, enrichedInput, dto.sessionId).catch(
      (error) => {
        this.pushSSE(stream, {
          type: StreamType.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        stream.push(null);
      },
    );

    return stream;
  }

  private buildEnrichedInput(input: string, context: GraphContext): string {
    const parts: string[] = [];

    if (context.entities.length > 0) {
      const entitySummary = context.entities
        .slice(0, 20)
        .map(
          (e) =>
            `- ${e.label}: ${e.name}${Object.keys(e.properties).length > 1 ? ` (${Object.entries(e.properties).filter(([k]) => k !== 'name').slice(0, 3).map(([k, v]) => `${k}: ${String(v)}`).join(', ')})` : ''}`,
        )
        .join('\n');
      parts.push(`<RelevantEntities>\n${entitySummary}\n</RelevantEntities>`);
    }

    if (context.relationships.length > 0) {
      const relSummary = context.relationships
        .slice(0, 15)
        .map((r) => `- ${r.from} -[${r.type}]-> ${r.to}`)
        .join('\n');
      parts.push(
        `<RelevantRelationships>\n${relSummary}\n</RelevantRelationships>`,
      );
    }

    if (context.persona) {
      const personaStr = [
        `Role: ${context.persona.role}`,
        `Department: ${context.persona.department}`,
        `Focus Areas: ${context.persona.focusAreas.join(', ')}`,
        `Goals: ${context.persona.goals}`,
      ].join('\n');
      parts.push(`<ActivePersona>\n${personaStr}\n</ActivePersona>`);
    }

    parts.push(`<Intent>${context.intent}</Intent>`);
    parts.push(input);

    return parts.join('\n\n');
  }

  private async executeAndPipe(
    stream: Readable,
    enrichedInput: string,
    sessionId?: string,
  ): Promise<void> {
    const domoResponse = await this.agents.executeStream(
      this.huckleberryAgentId,
      { input: enrichedInput, sessionId },
    );

    if (!domoResponse.ok) {
      const text = await domoResponse.text().catch(() => '');
      this.pushSSE(stream, {
        type: StreamType.ERROR,
        message: `Agent execution failed: ${domoResponse.status} ${text}`,
      });
      stream.push(null);
      return;
    }

    if (!domoResponse.body) {
      this.pushSSE(stream, {
        type: StreamType.ERROR,
        message: 'Agent returned no response body',
      });
      stream.push(null);
      return;
    }

    const reader = (
      domoResponse.body as import('node:stream/web').ReadableStream
    ).getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Pass through the raw SSE bytes from the Domo agent stream
        const chunk = decoder.decode(value, { stream: true });
        stream.push(chunk);
      }
    } finally {
      reader.releaseLock();
      stream.push(null);
    }
  }

  private pushSSE(stream: Readable, message: StreamMessage): void {
    stream.push(`data: ${JSON.stringify(message)}\n\n`);
  }
}
