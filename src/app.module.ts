import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { DomoContextInterceptor } from './common/auth/domo-context.interceptor.js';
import configuration, {
  type AppConfig,
} from './common/config/configuration.js';
import { HbThrottlerGuard } from './auth/guards/throttler.guard.js';
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
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const app = config.get<AppConfig>('app');
        return [
          {
            name: 'default',
            ttl: app.throttleGlobalTtl,
            limit: app.throttleGlobalLimit,
          },
        ];
      },
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
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
      provide: APP_GUARD,
      useClass: HbThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: DomoContextInterceptor,
    },
  ],
})
export class AppModule {}
