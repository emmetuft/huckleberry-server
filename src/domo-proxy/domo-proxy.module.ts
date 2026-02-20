import { Global, Module } from '@nestjs/common';
import { DomoProxyService } from './domo-proxy.service.js';

@Global()
@Module({
  providers: [DomoProxyService],
  exports: [DomoProxyService],
})
export class DomoProxyModule {}
