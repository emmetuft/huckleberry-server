import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import configuration from './common/config/configuration.js';
import { AgentsModule } from './agents/agents.module.js';
import { AiServicesModule } from './ai-services/ai-services.module.js';
import { ConnectorsModule } from './connectors/connectors.module.js';
import { DataSourcesModule } from './datasources/datasources.module.js';
import { DomoProxyModule } from './domo-proxy/domo-proxy.module.js';
import { GraphModule } from './graph/graph.module.js';
import { HealthModule } from './health/health.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { HuckleberryModule } from './huckleberry/huckleberry.module.js';
import { McpModule } from './mcp/mcp.module.js';
import { PeopleModule } from './people/people.module.js';
import { PersonasModule } from './personas/personas.module.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { ToolkitsModule } from './toolkits/toolkits.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/api{/*path}', '/domo{/*path}', '/health{/*path}'],
    }),
    AgentsModule,
    AiServicesModule,
    ConnectorsModule,
    DataSourcesModule,
    DomoProxyModule,
    GraphModule,
    HealthModule,
    HuckleberryModule,
    IdentityModule,
    McpModule,
    PersonasModule,
    PeopleModule,
    SessionsModule,
    ToolkitsModule,
  ],
})
export class AppModule {}
