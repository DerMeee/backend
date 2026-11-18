import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { actorFrom, type RequestUser } from '../request-user';

/** Injects the current user as an audit `Actor` (user + client IP). Needs JwtAuthGuard. */
export const CurrentActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return actorFrom(req.user as RequestUser, req.ip);
  },
);
