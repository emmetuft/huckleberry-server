import { SetMetadata } from '@nestjs/common';

export const SKIP_CSRF_KEY = 'skipCsrf';

/** Apply to any route handler to skip the CSRF double-submit check. */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);
