import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DomoContextInterceptor } from './common/auth/domo-context.interceptor.js';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore TS1470 — import.meta.url is needed for ESM test mode; CJS branch uses __dirname
const _dirname = typeof __dirname !== 'undefined' ? __dirname : join(fileURLToPath(import.meta.url), '..');
import configuration from './common/config/configuration.js';
import { AuthModule } from './common/auth/auth.module.js';
import { DomoLinkModule } from './common/auth/domo-link/domo-link.module.js';
import { HuckleberryAuthModule } from './auth/auth.module.js';
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
import { WorkflowsModule } from './workflows/workflows.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: [`.env.${process.env.DOMO_TARGET || 'dev'}`, '.env'],
    }),
    ServeStaticModule.forRoot({
      rootPath: join(_dirname, '..', 'public'),
      exclude: [
        '/api{/*path}',
        '/domo{/*path}',
        '/health{/*path}',
        '/auth{/*path}',
        '/admin{/*path}',
      ],
    }),
    AuthModule,
    HuckleberryAuthModule,
    DomoLinkModule,
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
    WorkflowsModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: DomoContextInterceptor,
    },
  ],
})
export class AppModule {}
