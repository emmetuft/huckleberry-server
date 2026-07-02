// Jest setupFiles entry — loads ../.env so e2e specs see the same env the
// app uses at runtime. Path is relative to this file.
import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const _dirname =
  typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));
config({ path: resolve(_dirname, '..', '.env') });
