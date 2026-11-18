import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionMetadata } from '../decorator/require-permission.decorator';
import { PERMISSIONS_KEY, ROLE_PERMISSIONS, roleCan } from '../permissions';

// Re-exported for older imports.
export { ROLE_PERMISSIONS };

/** Checks the @Permissions() metadata against the role of `req.user` (set by JwtAuthGuard). */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as { role?: string } | undefined;
    if (!user?.role) {
      throw new ForbiddenException('Authentication required');
    }

    const required = this.reflector.getAllAndOverride<PermissionMetadata[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    for (const { resource, action } of required) {
      if (!roleCan(user.role, resource, action)) {
        throw new ForbiddenException(
          `You do not have permission to perform '${action}' on resource '${resource}'`,
        );
      }
    }
    return true;
  }
}
