import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IdentityService } from './identity.service.js';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';

@ApiTags('Identity')
@Controller('identity')
@UseGuards(DomoAuthGuard)
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Get('')
  getIdentity() {
    return this.identityService.getIdentity();
  }
}
