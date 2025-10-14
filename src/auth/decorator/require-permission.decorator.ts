import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

export interface PermissionMetadata {
  resource: string;
  action: string;
}

export const Permissions = (permissions: PermissionMetadata[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

