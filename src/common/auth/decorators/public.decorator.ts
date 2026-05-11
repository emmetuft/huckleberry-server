import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route as bypassing `GatekeeperAuthGuard` entirely (e.g. `/health`). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
