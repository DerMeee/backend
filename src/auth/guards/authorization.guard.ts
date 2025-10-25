import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, PermissionMetadata } from '../decorator/require-permission.decorator';

// Simple role → permissions mapping. Extend as needed.
const ROLE_PERMISSIONS: Record<string, Array<{ resource: string; actions: string[] }>> = {
  ADMIN: [
    { resource: 'users', actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'appointments', actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'products', actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'chats', actions: ['create', 'read', 'update', 'delete'] },
  ],
  DOCTOR: [
    { resource: 'appointments', actions: ['read', 'update'] },
    { resource: 'chats', actions: ['create', 'read'] },
    { resource: 'patients', actions: ['read'] },
    { resource: 'doctor', actions: ['create', "update", 'read', 'delete']}
  ],
  PATIENT: [
    { resource: 'appointments', actions: ['create', 'read'] },
    { resource: 'chats', actions: ['create', 'read'] },
    { resource: 'products', actions: ['read'] },
  ],
};

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user; // This comes from JWT auth guard

    // If no user is authenticated, deny access
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }
    console.log('user', user);

    try {
      const requiredPermissions = this.reflector.getAllAndOverride<PermissionMetadata[]>(
        PERMISSIONS_KEY,
        [context.getHandler(), context.getClass()],
      );
      console.log('requiredPermissions', requiredPermissions);
      
      // If no permissions are required, allow access
      if (!requiredPermissions || requiredPermissions.length === 0) {
        return true;
      }

      const role: string = user?.role;
      const userPermissions = ROLE_PERMISSIONS[role] ?? [];
      console.log('userPermissions', userPermissions);

      // Check each required permission
      for (const permission of requiredPermissions) {
        const { resource, action } = permission;
        
        // Find if user has permission for this resource
        const userPermission = userPermissions.find(p => p.resource === resource);
        
        if (!userPermission) {
          console.log(`User does not have permission for resource: ${resource}`);
          throw new ForbiddenException(`You do not have permission to access resource: ${resource}`);
        }

        // Check if user has the required action for this resource
        if (!userPermission.actions.includes(action)) {
          console.log(`User does not have action '${action}' for resource '${resource}'`);
          throw new ForbiddenException(`You do not have permission to perform '${action}' on resource '${resource}'`);
        }
      }
      
      return true;
    } catch (error) {
      console.error('Authorization error:', error);
      if (error instanceof ForbiddenException) {
        throw error;
      }
      throw new ForbiddenException('Error checking permissions');
    }
  }
}
