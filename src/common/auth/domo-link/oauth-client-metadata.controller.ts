import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration.js';
import { DomoOAuthClient } from './domo-oauth.client.js';
import { Public } from '../decorators/public.decorator.js';

@Controller('.well-known/oauth-client')
export class OAuthClientMetadataController {
  private readonly document: Record<string, unknown>;

  constructor(config: ConfigService, client: DomoOAuthClient) {
    const app = config.get<AppConfig>('app');
    this.document = {
      client_id: client.getMetadataDocumentUrl(),
      client_name: 'huckleberry',
      redirect_uris: [app?.domoOAuthRedirectUri ?? ''],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: app?.domoOAuthScopes ?? '',
    };
  }

  @Get()
  @Public()
  getMetadata(
    @Res({ passthrough: true }) res: Response,
  ): Record<string, unknown> {
    res.setHeader('Cache-Control', 'max-age=300, public');
    return this.document;
  }
}
