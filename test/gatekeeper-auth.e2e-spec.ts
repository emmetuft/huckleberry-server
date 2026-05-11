/**
 * Live-Gatekeeper integration test.
 *
 * Skips automatically unless GATEKEEPER_TEST_TOKEN is set. Reads the same
 * env-driven config the app would use, so any mismatch surfaces here first.
 *
 * Required:
 *   GATEKEEPER_TEST_TOKEN — a real Gatekeeper-issued access token to verify
 * One of (allowlist source):
 *   GATEKEEPER_ISSUERS    — CSV of trusted issuers
 *   GATEKEEPER_ISSUER     — single-issuer legacy
 *   DOMO_INSTANCE_URL     — dev fallback
 * Optional:
 *   GATEKEEPER_JWKS_URIS  — per-issuer JWKS override (iss=uri,iss=uri)
 *   GATEKEEPER_JWKS_URI   — single-issuer JWKS override
 *   GATEKEEPER_AUDIENCE   — exact aud to require
 */

import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { GatekeeperAuthGuard } from '../src/common/auth/gatekeeper-auth.guard';
import { JwksService } from '../src/common/auth/jwks.service';
import { KnownTenantsService } from '../src/common/auth/known-tenants.service';

function stripSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

function parseIssuers(): string[] {
  const csv = process.env.GATEKEEPER_ISSUERS || '';
  if (csv) return csv.split(',').map((s) => stripSlash(s.trim())).filter(Boolean);
  const single = process.env.GATEKEEPER_ISSUER || process.env.DOMO_INSTANCE_URL || '';
  return single ? [stripSlash(single)] : [];
}

function parseJwksOverrides(): Record<string, string> {
  const overrides: Record<string, string> = {};
  const legacy = process.env.GATEKEEPER_JWKS_URI;
  const legacyIssuer =
    process.env.GATEKEEPER_ISSUER || process.env.DOMO_INSTANCE_URL;
  if (legacy && legacyIssuer) overrides[stripSlash(legacyIssuer)] = legacy;
  const csv = process.env.GATEKEEPER_JWKS_URIS || '';
  for (const pair of csv.split(',').map((s) => s.trim()).filter(Boolean)) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    overrides[stripSlash(pair.slice(0, eq).trim())] = pair.slice(eq + 1).trim();
  }
  return overrides;
}

const issuers = parseIssuers();
const overrides = parseJwksOverrides();
const audience = process.env.GATEKEEPER_AUDIENCE || '';
const token = process.env.GATEKEEPER_TEST_TOKEN;

const describeLive = issuers.length > 0 && token ? describe : describe.skip;

function makeGuard(): GatekeeperAuthGuard {
  const config = {
    get: jest.fn().mockReturnValue({
      gatekeeperIssuers: issuers,
      gatekeeperJwksUriOverrides: overrides,
      gatekeeperAudience: audience,
    }),
  } as unknown as ConfigService;

  const reflector = {
    getAllAndOverride: jest.fn(() => undefined),
  } as unknown as Reflector;

  return new GatekeeperAuthGuard(
    config,
    reflector,
    new JwksService(config),
    new KnownTenantsService(config),
  );
}

function makeContext(authHeader: string): ExecutionContext {
  const req = { headers: { authorization: authHeader }, query: {} };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describeLive('GatekeeperAuthGuard (live Gatekeeper)', () => {
  it('verifies a real Gatekeeper-issued token and attaches a principal', async () => {
    const guard = makeGuard();
    const ctx = makeContext(`Bearer ${token}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    const req = ctx.switchToHttp().getRequest<{
      user?: {
        customerId: string;
        sub: string;
        scopes: string[];
        issuer: string;
        rawToken: string;
      };
    }>();

    expect(req.user).toBeDefined();
    expect(issuers).toContain(req.user!.issuer);
    expect(req.user!.customerId).toBeTruthy();
    expect(req.user!.sub).toBeTruthy();
    expect(req.user!.rawToken).toBe(token);
    expect(Array.isArray(req.user!.scopes)).toBe(true);
  });

  it('rejects a tampered token (signature mismatch)', async () => {
    const guard = makeGuard();
    const parts = token!.split('.');
    const sig = parts[2];
    const flipped = `${sig.slice(0, -1)}${sig.slice(-1) === 'A' ? 'B' : 'A'}`;
    const tampered = `${parts[0]}.${parts[1]}.${flipped}`;
    const ctx = makeContext(`Bearer ${tampered}`);
    await expect(guard.canActivate(ctx)).rejects.toThrow();
  });
});
