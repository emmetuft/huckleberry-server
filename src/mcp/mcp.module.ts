import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller.js';
import { McpService } from './mcp.service.js';
import { MCP_REPOSITORY } from './mcp.repository.js';
import { DRIZZLE, type Db } from '../common/db/db.module.js';
import { MysqlMcpRepository } from '../common/db/repositories/mysql-mcp.repository.js';

@Module({
  controllers: [McpController],
  providers: [
    McpService,
    {
      provide: MCP_REPOSITORY,
      inject: [DRIZZLE],
      useFactory: (db: Db) => new MysqlMcpRepository(db),
    },
  ],
  exports: [McpService],
})
export class McpModule {}
