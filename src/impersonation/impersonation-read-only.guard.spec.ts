import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ImpersonationReadOnlyGuard } from './impersonation-read-only.guard';

const SECRET = 'test-secret';
const jwt = new JwtService({});
const impToken = jwt.sign(
  { userId: 'u1', role: 'PATIENT', imp: { sid: 's1', by: 'a1' } },
  { secret: SECRET },
);
const normalToken = jwt.sign(
  { userId: 'u1', role: 'PATIENT' },
  { secret: SECRET },
);

function ctx(
  method: string,
  token?: string,
  allowed = false,
): ExecutionContext {
  const handler = () => undefined;
  if (allowed)
    Reflect.defineMetadata('allowDuringImpersonation', true, handler);
  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        headers: token ? { authorization: `Bearer ${token}` } : {},
        cookies: {},
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('ImpersonationReadOnlyGuard', () => {
  const guard = new ImpersonationReadOnlyGuard(jwt, new Reflector());
  beforeAll(() => {
    process.env.JWT_SECRET = SECRET;
  });

  it('lets impersonation tokens read', () => {
    expect(guard.canActivate(ctx('GET', impToken))).toBe(true);
    expect(guard.canActivate(ctx('HEAD', impToken))).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'blocks %s with an impersonation token',
    (method) => {
      expect(() => guard.canActivate(ctx(method, impToken))).toThrow(
        ForbiddenException,
      );
    },
  );

  it('allows routes marked @AllowDuringImpersonation (exit)', () => {
    expect(guard.canActivate(ctx('POST', impToken, true))).toBe(true);
  });

  it('does not interfere with normal or missing or invalid tokens', () => {
    expect(guard.canActivate(ctx('POST', normalToken))).toBe(true);
    expect(guard.canActivate(ctx('POST'))).toBe(true);
    expect(guard.canActivate(ctx('POST', 'garbage'))).toBe(true);
  });
});
