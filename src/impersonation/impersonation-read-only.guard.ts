import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import {
  extractAccessToken,
  type AccessTokenPayload,
} from '../auth/strategies/jwt.strategy';
import { ALLOW_DURING_IMPERSONATION } from './allow-during-impersonation.decorator';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard: an impersonation token can only read.
 *
 * Global guards run before route guards, so `req.user` isn't set yet here; the guard reads
 * and verifies the token itself. Any request that isn't an impersonation (no token, normal
 * token, invalid token) passes through untouched and is handled by the route's own guards.
 */
@Injectable()
export class ImpersonationReadOnlyGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;

    const token = extractAccessToken(req);
    if (!token) return true;
    let payload: AccessTokenPayload;
    try {
      payload = this.jwt.verify<AccessTokenPayload>(token, {
        secret: process.env.JWT_SECRET,
      });
    } catch {
      return true; // Not our concern: JwtAuthGuard rejects bad tokens where auth is required.
    }
    if (!payload.imp) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_DURING_IMPERSONATION,
      [context.getHandler(), context.getClass()],
    );
    if (allowed) return true;
    throw new ForbiddenException(
      'Read-only: you are viewing the platform as another user. Exit "view as user" to make changes.',
    );
  }
}
