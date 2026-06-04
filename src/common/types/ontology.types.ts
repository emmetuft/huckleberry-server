/** Graph node returned by Neo4j queries */
interface Neo4jNode {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
}

/** Graph relationship returned by Neo4j queries */
interface Neo4jRelationship {
  id: string;
  type: string;
  startNodeId: string;
  endNodeId: string;
  properties: Record<string, unknown>;
}

/** Standard graph data envelope */
export interface GraphData {
  nodes: Neo4jNode[];
  relationships: Neo4jRelationship[];
}
