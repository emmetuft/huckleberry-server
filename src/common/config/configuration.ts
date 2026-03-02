export interface AppConfig {
  domoInstanceUrl: string;
  devToken: string;
  nodeEnv: string;
  port: number;
  verboseLogging: boolean;
  huckleberryAgentId: string;
  neo4jUri: string;
  neo4jUser: string;
  neo4jPassword: string;
  neo4jDatabase: string;
}

export default (): { app: AppConfig } => ({
  app: {
    domoInstanceUrl: process.env.DOMO_INSTANCE_URL || '',
    devToken: process.env.DEV_TOKEN || '',
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    verboseLogging: process.env.VERBOSE_LOGGING === 'true',
    huckleberryAgentId: process.env.HUCKLEBERRY_AGENT_ID || '',
    neo4jUri: process.env.NEO4J_URI || '',
    neo4jUser: process.env.NEO4J_USER || 'neo4j',
    neo4jPassword: process.env.NEO4J_PASSWORD || '',
    neo4jDatabase: process.env.NEO4J_DATABASE || 'neo4j',
  },
});
