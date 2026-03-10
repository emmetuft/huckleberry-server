import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { Driver, Session, Integer } from 'neo4j-driver';
import type { AppConfig } from '../common/config/configuration.js';
import type {
  GraphData,
  Neo4jNode,
  Neo4jRelationship,
} from '../common/types/ontology.types.js';

@Injectable()
export class Neo4jService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Neo4jService.name);
  private driver!: Driver;
  private database: string;
  private connected = false;

  constructor(private readonly config: ConfigService) {
    const appConfig = this.config.get<AppConfig>('app')!;
    this.database = (appConfig as any).neo4jDatabase ?? 'neo4j';
  }

  async onModuleInit(): Promise<void> {
    const appConfig = this.config.get<AppConfig>('app')!;
    const uri = (appConfig as any).neo4jUri;
    const user = (appConfig as any).neo4jUser;
    const password = (appConfig as any).neo4jPassword;

    if (!uri) {
      this.logger.warn(
        'NEO4J_URI is not configured — ontology queries will fail',
      );
      return;
    }

    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
    try {
      await this.driver.verifyConnectivity();
      this.connected = true;
      this.logger.log(`Connected to Neo4j at ${uri}`);
    } catch (error) {
      this.logger.warn(`Neo4j connectivity check failed: ${String(error)}`);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
    }
  }

  private getSession(): Session {
    return this.driver.session({ database: this.database });
  }

  async fetchLabels(): Promise<string[]> {
    const session = this.getSession();
    try {
      const result = await session.run('CALL db.labels() YIELD label RETURN label ORDER BY label');
      return result.records.map((r) => r.get('label') as string);
    } finally {
      await session.close();
    }
  }

  async fetchPropertyValues(
    label: string,
    property: string,
    limit: number = 100,
  ): Promise<unknown[]> {
    const session = this.getSession();
    try {
      const result = await session.run(
        `MATCH (n:\`${label}\`) WHERE n[$property] IS NOT NULL ` +
          `RETURN DISTINCT n[$property] AS value LIMIT $limit`,
        { property, limit: Integer.fromNumber(limit) },
      );
      return result.records.map((r) => this.toNative(r.get('value')));
    } finally {
      await session.close();
    }
  }

  async fetchNodes(params: {
    labels?: string[];
    filters?: Array<Record<string, unknown>>;
    limit?: number;
    includeRelationships?: boolean;
  }): Promise<GraphData> {
    const session = this.getSession();
    try {
      const labelClause =
        params.labels?.length
          ? params.labels.map((l) => `:\`${l}\``).join('')
          : '';

      const limit = params.limit ?? 100;

      const nodeResult = await session.run(
        `MATCH (n${labelClause}) RETURN n LIMIT $limit`,
        { limit: Integer.fromNumber(limit) },
      );

      const nodes = nodeResult.records.map((r) => this.mapNode(r.get('n')));

      let relationships: Neo4jRelationship[] = [];
      if (params.includeRelationships && nodes.length > 0) {
        const nodeIds = nodes.map((n) => n.id);
        const relResult = await session.run(
          `MATCH (a)-[r]->(b) WHERE elementId(a) IN $ids AND elementId(b) IN $ids RETURN r`,
          { ids: nodeIds },
        );
        relationships = relResult.records.map((r) =>
          this.mapRelationship(r.get('r')),
        );
      }

      return { nodes, relationships };
    } finally {
      await session.close();
    }
  }

  async fetchSubgraph(
    nodeId: string,
    depth: number = 2,
    limit: number = 500,
  ): Promise<GraphData> {
    const session = this.getSession();
    try {
      const result = await session.run(
        `MATCH path = (start)-[*1..${Math.min(depth, 5)}]-(connected) ` +
          `WHERE elementId(start) = $nodeId ` +
          `WITH nodes(path) AS ns, relationships(path) AS rs LIMIT $limit ` +
          `UNWIND ns AS n WITH COLLECT(DISTINCT n) AS allNodes, COLLECT(rs) AS allRelSets ` +
          `UNWIND allRelSets AS relSet UNWIND relSet AS r ` +
          `RETURN allNodes, COLLECT(DISTINCT r) AS allRels`,
        { nodeId, limit: Integer.fromNumber(limit) },
      );

      if (result.records.length === 0) {
        return { nodes: [], relationships: [] };
      }

      const record = result.records[0];
      const nodes = (record.get('allNodes') as any[]).map((n) =>
        this.mapNode(n),
      );
      const relationships = (record.get('allRels') as any[]).map((r) =>
        this.mapRelationship(r),
      );

      return { nodes, relationships };
    } finally {
      await session.close();
    }
  }

  async searchNodes(query: string, limit: number = 100): Promise<GraphData> {
    const session = this.getSession();
    try {
      // Try full-text index first, fall back to CONTAINS
      let result;
      try {
        result = await session.run(
          `CALL db.index.fulltext.queryNodes("nodeFulltext", $query) YIELD node, score ` +
            `RETURN node ORDER BY score DESC LIMIT $limit`,
          { query, limit: Integer.fromNumber(limit) },
        );
      } catch {
        result = await session.run(
          `MATCH (n) WHERE any(key IN keys(n) WHERE toString(n[key]) CONTAINS $query) ` +
            `RETURN n AS node LIMIT $limit`,
          { query, limit: Integer.fromNumber(limit) },
        );
      }

      const nodes = result.records.map((r) => this.mapNode(r.get('node')));
      return { nodes, relationships: [] };
    } finally {
      await session.close();
    }
  }

  private mapNode(node: any): Neo4jNode {
    return {
      id: node.elementId ?? node.identity?.toString(),
      labels: Array.from(node.labels),
      properties: this.toNativeObject(node.properties),
    };
  }

  private mapRelationship(rel: any): Neo4jRelationship {
    return {
      id: rel.elementId ?? rel.identity?.toString(),
      type: rel.type,
      startNodeId: rel.startNodeElementId ?? rel.start?.toString(),
      endNodeId: rel.endNodeElementId ?? rel.end?.toString(),
      properties: this.toNativeObject(rel.properties),
    };
  }

  private toNativeObject(obj: Record<string, any>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.toNative(value);
    }
    return result;
  }

  private toNative(value: any): unknown {
    if (value == null) return value;
    if (neo4j.isInt(value)) return value.toNumber();
    if (Array.isArray(value)) return value.map((v) => this.toNative(v));
    if (typeof value === 'object' && value.constructor === Object) {
      return this.toNativeObject(value);
    }
    return value;
  }
}
