// Jest setupFiles entry — loads ../.env so e2e specs see the same env the
// app uses at runtime. Path is relative to this file.
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '..', '.env') });
