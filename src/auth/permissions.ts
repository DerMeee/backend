/**
 * Role → permissions table used by AuthorizationGuard.
 * Resources are constants so a typo fails at compile time instead of returning 403 at runtime.
 */
export const PERMISSIONS_KEY = 'permissions';

export const Resource = {
  USERS: 'users',
  APPOINTMENTS: 'appointments',
  PRODUCTS: 'products',
  CHATS: 'chats',
  PATIENTS: 'patients',
  DOCTOR: 'doctor',
  // Admin back office
  ADMIN_DASHBOARD: 'admin-dashboard',
  DOCTORS: 'doctors',
  ORDERS: 'orders',
  AUDIT_LOGS: 'audit-logs',
  IMPERSONATION: 'impersonation',
  SETTINGS: 'settings',
} as const;
export type Resource = (typeof Resource)[keyof typeof Resource];

export const Action = {
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',
} as const;
export type Action = (typeof Action)[keyof typeof Action];

const CRUD: Action[] = ['create', 'read', 'update', 'delete'];

export const ROLE_PERMISSIONS: Record<
  string,
  Array<{ resource: Resource; actions: Action[] }>
> = {
  ADMIN: [
    { resource: Resource.USERS, actions: CRUD },
    { resource: Resource.APPOINTMENTS, actions: CRUD },
    { resource: Resource.PRODUCTS, actions: CRUD },
    { resource: Resource.CHATS, actions: CRUD },
    { resource: Resource.ADMIN_DASHBOARD, actions: ['read'] },
    { resource: Resource.DOCTORS, actions: ['read', 'update'] },
    { resource: Resource.ORDERS, actions: CRUD },
    { resource: Resource.AUDIT_LOGS, actions: ['read'] },
    { resource: Resource.IMPERSONATION, actions: ['create'] },
    { resource: Resource.SETTINGS, actions: ['read', 'update'] },
  ],
  DOCTOR: [
    { resource: Resource.APPOINTMENTS, actions: ['read', 'update'] },
    { resource: Resource.CHATS, actions: ['create', 'read'] },
    { resource: Resource.PATIENTS, actions: ['read'] },
    { resource: Resource.DOCTOR, actions: CRUD },
  ],
  PATIENT: [
    { resource: Resource.APPOINTMENTS, actions: ['create', 'read'] },
    { resource: Resource.CHATS, actions: ['create', 'read'] },
    { resource: Resource.PRODUCTS, actions: ['read'] },
  ],
};

export function roleCan(
  role: string,
  resource: string,
  action: string,
): boolean {
  const perm = (ROLE_PERMISSIONS[role] ?? []).find(
    (p) => p.resource === resource,
  );
  return !!perm && perm.actions.includes(action as Action);
}
