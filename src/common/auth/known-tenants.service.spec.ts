import { jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KnownTenantsService } from './known-tenants.service';

function makeConfig(issuers: string[]): ConfigService {
  return {
    get: jest.fn().mockReturnValue({ gatekeeperIssuers: issuers }),
  } as unknown as ConfigService;
}

describe('KnownTenantsService', () => {
  it('accepts an allowlisted issuer', () => {
    const svc = new KnownTenantsService(
      makeConfig(['https://cust1.domo.com', 'https://cust2.domo.com']),
    );
    expect(() => svc.assertAllowed('https://cust1.domo.com')).not.toThrow();
    expect(() => svc.assertAllowed('https://cust2.domo.com')).not.toThrow();
  });

  it('rejects an issuer not on the allowlist', () => {
    const svc = new KnownTenantsService(makeConfig(['https://cust1.domo.com']));
    expect(() => svc.assertAllowed('https://evil.domo.com')).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a missing iss claim', () => {
    const svc = new KnownTenantsService(makeConfig(['https://cust1.domo.com']));
    expect(() => svc.assertAllowed(undefined)).toThrow(UnauthorizedException);
  });

  it('parseCustomerId pulls the first hostname label as a fallback', () => {
    const svc = new KnownTenantsService(makeConfig(['https://cust1.domo.com']));
    expect(svc.parseCustomerId('https://cust1.domo.com')).toBe('cust1');
  });

  it('parseCustomerId rejects a malformed iss', () => {
    const svc = new KnownTenantsService(makeConfig(['https://cust1.domo.com']));
    expect(() => svc.parseCustomerId('not-a-url')).toThrow(
      UnauthorizedException,
    );
  });

  it('lists the configured issuers', () => {
    const svc = new KnownTenantsService(
      makeConfig(['https://cust1.domo.com', 'https://cust2.domo.com']),
    );
    expect(svc.list()).toEqual([
      'https://cust1.domo.com',
      'https://cust2.domo.com',
    ]);
  });

  it('warns and rejects when no issuers are configured', () => {
    const svc = new KnownTenantsService(makeConfig([]));
    expect(() => svc.assertAllowed('https://cust1.domo.com')).toThrow(
      UnauthorizedException,
    );
  });
});
