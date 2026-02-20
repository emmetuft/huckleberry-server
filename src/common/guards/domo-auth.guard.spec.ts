import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomoAuthGuard } from './domo-auth.guard';

function createMockContext(
  headers: Record<string, string> = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('DomoAuthGuard', () => {
  it('should allow requests in dev mode when DEV_TOKEN is set', () => {
    const config = {
      get: jest.fn().mockReturnValue({
        nodeEnv: 'development',
        devToken: 'test-token',
      }),
    } as unknown as ConfigService;

    const guard = new DomoAuthGuard(config);
    expect(guard.canActivate(createMockContext())).toBe(true);
  });

  it('should reject in dev mode when DEV_TOKEN is missing', () => {
    const config = {
      get: jest.fn().mockReturnValue({
        nodeEnv: 'development',
        devToken: '',
      }),
    } as unknown as ConfigService;

    const guard = new DomoAuthGuard(config);
    expect(() => guard.canActivate(createMockContext())).toThrow(
      UnauthorizedException,
    );
  });

  it('should allow requests in production with embedded security header', () => {
    const config = {
      get: jest.fn().mockReturnValue({
        nodeEnv: 'production',
        devToken: '',
      }),
    } as unknown as ConfigService;

    const guard = new DomoAuthGuard(config);
    const ctx = createMockContext({
      'x-domo-embedded-security': 'some-token',
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow requests in production with developer token header', () => {
    const config = {
      get: jest.fn().mockReturnValue({
        nodeEnv: 'production',
        devToken: '',
      }),
    } as unknown as ConfigService;

    const guard = new DomoAuthGuard(config);
    const ctx = createMockContext({
      'x-domo-developer-token': 'some-token',
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should reject in production without any auth header', () => {
    const config = {
      get: jest.fn().mockReturnValue({
        nodeEnv: 'production',
        devToken: '',
      }),
    } as unknown as ConfigService;

    const guard = new DomoAuthGuard(config);
    expect(() => guard.canActivate(createMockContext())).toThrow(
      UnauthorizedException,
    );
  });
});
