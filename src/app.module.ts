import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './common/config/configuration.js';
import { DomoProxyModule } from './domo-proxy/domo-proxy.module.js';
import { HealthModule } from './health/health.module.js';
import { AgentsModule } from './agents/agents.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    DomoProxyModule,
    HealthModule,
    AgentsModule,
  ],
})
export class AppModule {}
