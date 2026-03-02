import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AppConfig } from '../config/configuration.js';
import { DomoHeader } from '../constants/http.constants.js';

@Injectable()
export class DomoAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const appConfig = this.config.get<AppConfig>('app');

    if (appConfig.nodeEnv === 'development') {
      if (!appConfig.devToken) {
        throw new UnauthorizedException('DEV_TOKEN is not configured');
      }
      return true;
    }

    const embeddedToken = request.headers[DomoHeader.EmbeddedSecurity];
    const devToken = request.headers[DomoHeader.DeveloperToken];
    const epsToken = request.headers[DomoHeader.EpsAuthToken];

    if (!embeddedToken && !devToken && !epsToken) {
      throw new UnauthorizedException('Missing authentication token');
    }

    return true;
  }
}
