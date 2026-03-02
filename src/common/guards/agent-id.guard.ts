import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { AgentsService } from '../../agents/agents.service.js';

@Injectable()
export class AgentIdGuard implements CanActivate {
  constructor(private readonly agentsService: AgentsService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const agentId = request.params.agentId as string | undefined;

    if (!agentId) {
      return true;
    }

    if (!this.agentsService.isValidAgent(agentId)) {
      throw new NotFoundException(`Agent '${agentId}' not found in registry`);
    }

    return true;
  }
}
