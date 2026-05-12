/**
 * Operator onboarding CLI — Layer A seeder.
 *
 * Inserts a `users` row in `pending_link` state and immediately issues a
 * magic-link email so the new user can sign in. Linkage to their Domo
 * instance is completed in-app on first sign-in.
 *
 * Usage:
 *   tsx scripts/onboard-user.ts --email=user@customer.com --issuer=https://customer.domo.com --customer-id=customer [--display-name="Jane Doe"]
 *
 * For MVP this talks to the running BFF in-memory store via repository
 * services injected through a bare Nest application context (no HTTP
 * server). When Aurora lands, the same script writes through the
 * repository — no script changes needed.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../src/auth/user.repository.js';
import type { User } from '../src/auth/types.js';

interface Args {
  email: string;
  issuer: string;
  customerId: string;
  displayName: string | null;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  for (const raw of argv.slice(2)) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq <= 2) continue;
    flags.set(raw.slice(2, eq), raw.slice(eq + 1));
  }
  const email = flags.get('email');
  const issuer = flags.get('issuer');
  const customerId = flags.get('customer-id');
  if (!email || !issuer || !customerId) {
    console.error(
      'Required: --email=... --issuer=... --customer-id=... [--display-name=...]',
    );
    process.exit(1);
  }
  return {
    email: email.toLowerCase().trim(),
    issuer: issuer.replace(/\/+$/, ''),
    customerId,
    displayName: flags.get('display-name') ?? null,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const users = app.get<UserRepository>(USER_REPOSITORY);
    const auth = app.get(AuthService);

    const existing = await users.findByEmail(args.email);
    if (existing) {
      console.error(`user already exists: ${args.email} (${existing.id})`);
      process.exit(2);
    }

    const now = new Date();
    const user: User = {
      id: randomUUID(),
      email: args.email,
      emailVerified: false,
      displayName: args.displayName,
      status: 'pending_link',
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    };
    await users.insert(user);
    console.log(`created user ${user.id} <${user.email}>`);
    console.log(
      `[next step — Layer B]: link the Domo instance ${args.issuer} (customer_id=${args.customerId}) via DomoLink module once it lands`,
    );

    // Issue an immediate sign-in link so the user can land in the app.
    await auth.requestMagicLink(user.email, null);
    console.log(
      'magic-link email sent (in dev, check the BFF logs for the URL)',
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
