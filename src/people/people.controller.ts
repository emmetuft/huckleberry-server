import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PeopleService } from './people.service.js';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';

@ApiTags('People')
@Controller()
@UseGuards(DomoAuthGuard)
export class PeopleController {
  constructor(private readonly peopleService: PeopleService) {}

  @Get('users')
  async getUsers(@Query('ids') ids?: string) {
    if (ids && ids.length > 0) {
      const users = await this.peopleService.getUsersByIds(ids);
      return users;
    }
    return this.peopleService.getUsers();
  }

  @Get('users/:id')
  getUserById(@Param('id') id: string) {
    return this.peopleService.getUserById(id);
  }

  @Get('groups')
  getGroups(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.peopleService.getGroups(
      limit != null ? Number(limit) : undefined,
      offset != null ? Number(offset) : undefined,
    );
  }

  @Get('groups/:id')
  getGroupById(@Param('id') id: string) {
    return this.peopleService.getGroupById(id);
  }
}
