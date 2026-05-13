import { Injectable, UnauthorizedException } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import { DomoAuthBroker } from '../common/auth/domo-link/domo-auth.broker.js';
import { DomoLinkService } from '../common/auth/domo-link/domo-link.service.js';
import type { DomoUser } from '../common/types/people.types.js';
import type { HuckleberryPrincipal } from '../auth/types.js';

@Injectable()
export class IdentityService {
  constructor(
    private readonly domo: DomoProxyService,
    private readonly link: DomoLinkService,
    private readonly broker: DomoAuthBroker,
  ) {}

  async getIdentity(principal: HuckleberryPrincipal): Promise<DomoUser> {
    const activeLink = await this.link.activeLinkFor(principal.userId);
    if (!activeLink) {
      throw new UnauthorizedException({
        error: 'domo_link_required',
        error_description:
          'No linked Domo instance. Start the linkage flow via POST /api/auth/domo/link/start.',
      });
    }
    const bearer = await this.broker.tokenFor(activeLink.id);
    return this.domo.get<DomoUser>('/api/content/v3/users/me', {
      targetHost: activeLink.issuerUrl,
      bearer,
    });
  }
}
