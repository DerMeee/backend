import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse } from '@nestjs/swagger';
import { PERMISSIONS_KEY, type Action, type Resource } from '../permissions';
import { JwtAuthGuard } from '../guards/jwt-aut.guard';
import { AuthorizationGuard } from '../guards/authorization.guard';

export { PERMISSIONS_KEY };

export interface PermissionMetadata {
  resource: Resource;
  action: Action;
}

export const Permissions = (permissions: PermissionMetadata[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Login + role permission check in one decorator, for admin controllers and routes.
 * Route-level metadata overrides the controller-level one.
 */
export const AdminAccess = (resource: Resource, action: Action) =>
  applyDecorators(
    UseGuards(JwtAuthGuard, AuthorizationGuard),
    Permissions([{ resource, action }]),
    ApiBearerAuth(),
    ApiForbiddenResponse({ description: 'Not an administrator' }),
  );
