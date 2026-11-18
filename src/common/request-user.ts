import type { UserRole } from '@prisma/client';

/** What JwtStrategy puts on `req.user` for every authenticated request. */
export interface RequestUser {
  /** Same as userId; kept because older code reads `user.id`. */
  id: string;
  userId: string;
  role: UserRole;
  email: string;
  /** Set only during a read-only impersonation session: the admin behind it. */
  impersonatorId?: string;
  impersonationSessionId?: string;
}

/** Who did an action, for audit logs and status histories. */
export interface Actor {
  userId: string | null;
  role: UserRole | 'SYSTEM';
  email?: string | null;
  impersonatorId?: string | null;
  ip?: string | null;
}

export const SYSTEM_ACTOR: Actor = { userId: null, role: 'SYSTEM' };

export function actorFrom(user: RequestUser, ip?: string | null): Actor {
  return {
    userId: user.userId,
    role: user.role,
    email: user.email,
    impersonatorId: user.impersonatorId ?? null,
    ip: ip ?? null,
  };
}
