export interface AppConfig {
  domoInstanceUrl: string;
  devToken: string;
  nodeEnv: string;
  port: number;
  verboseLogging: boolean;
  huckleberryAgentId: string;
}

export default (): { app: AppConfig } => ({
  app: {
    domoInstanceUrl: process.env.DOMO_INSTANCE_URL || '',
    devToken: process.env.DEV_TOKEN || '',
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    verboseLogging: process.env.VERBOSE_LOGGING === 'true',
    huckleberryAgentId: process.env.HUCKLEBERRY_AGENT_ID || '',
  },
});
