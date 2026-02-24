import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import configuration from './common/config/configuration.js';
import { DomoProxyModule } from './domo-proxy/domo-proxy.module.js';
import { HealthModule } from './health/health.module.js';
import { AgentsModule } from './agents/agents.module.js';
import { AiServicesModule } from './ai-services/ai-services.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/agents{/*path}', '/ai-services{/*path}', '/health{/*path}'],
    }),
    DomoProxyModule,
    HealthModule,
    AgentsModule,
    AiServicesModule,
  ],
})
export class AppModule {}
