import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/audit-actions';
import type { Actor, RequestUser } from '../common/request-user';
import { paginate, skipTake } from '../common/pagination';
import { catchServiceError } from '../utils/catch-service-error';
import type { AccessTokenPayload } from '../auth/strategies/jwt.strategy';

/** Impersonation tokens are short and can't be refreshed. */
export const IMPERSONATION_TTL_MINUTES = 30;

@Injectable()
export class ImpersonationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Starts a read-only session as `targetUserId` and returns a separate access token.
   * The admin keeps their own tokens; the frontend stores this one apart and drops it on exit.
   */
  async start(
    admin: Actor,
    targetUserId: string,
    reason: string | undefined,
    userAgent: string | undefined,
  ) {
    try {
      if (!admin.userId) throw new ForbiddenException('Administrator required');
      if (admin.impersonatorId)
        throw new ForbiddenException('Exit the current impersonation first');
      const target = await this.prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, name: true, email: true, role: true, status: true },
      });
      if (!target) throw new NotFoundException('User not found');
      if (target.role === 'ADMIN')
        throw new ForbiddenException('Administrators cannot be impersonated');
      if (target.id === admin.userId)
        throw new BadRequestException('You cannot impersonate yourself');
      // Suspended accounts can't sign in; impersonation doesn't get around that.
      if (target.status === 'SUSPENDED') {
        throw new BadRequestException(
          'This account is suspended and cannot be viewed as the user',
        );
      }

      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + IMPERSONATION_TTL_MINUTES * 60_000,
      );
      const session = await this.prisma.$transaction(async (tx) => {
        // One session per admin at a time.
        const replaced = await tx.impersonationSession.findMany({
          where: {
            adminId: admin.userId!,
            endedAt: null,
            expiresAt: { gt: now },
          },
          select: { id: true, targetUserId: true },
        });
        if (replaced.length) {
          await tx.impersonationSession.updateMany({
            where: { id: { in: replaced.map((r) => r.id) } },
            data: { endedAt: now, endReason: 'REPLACED' },
          });
          for (const r of replaced) {
            await this.logEnd(tx, admin, r.id, r.targetUserId, 'REPLACED');
          }
        }
        const created = await tx.impersonationSession.create({
          data: {
            adminId: admin.userId!,
            targetUserId: target.id,
            reason: reason?.trim() || null,
            expiresAt,
            ip: admin.ip ?? null,
            userAgent: userAgent?.slice(0, 300) ?? null,
          },
        });
        await this.audit.log(tx, {
          actor: admin,
          action: AuditAction.IMPERSONATION_STARTED,
          entityType: AuditEntity.IMPERSONATION,
          entityId: created.id,
          after: {
            targetUserId: target.id,
            targetRole: target.role,
            expiresAt,
          },
          metadata: { reason: reason ?? null, targetEmail: target.email },
        });
        return created;
      });

      const payload: AccessTokenPayload = {
        userId: target.id,
        role: target.role,
        imp: { sid: session.id, by: admin.userId },
      };
      const accessToken = this.jwt.sign(payload, {
        secret: this.config.get<string>('JWT_SECRET'),
        expiresIn: `${IMPERSONATION_TTL_MINUTES}m`,
      });
      return {
        accessToken,
        readOnly: true,
        expiresAt,
        session: { id: session.id, startedAt: session.startedAt },
        target: { id: target.id, name: target.name, role: target.role },
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  /** Ends a session: called with the impersonation token (exit button) or by the admin. */
  async end(
    sessionId: string,
    caller: { userId: string | null; impersonatorId?: string | null },
    actor: Actor,
  ) {
    try {
      const session = await this.prisma.impersonationSession.findUnique({
        where: { id: sessionId },
      });
      if (!session) throw new NotFoundException('Session not found');
      const adminId = caller.impersonatorId ?? caller.userId;
      if (session.adminId !== adminId)
        throw new ForbiddenException('Not your impersonation session');
      if (session.endedAt)
        return { id: session.id, endedAt: session.endedAt, alreadyEnded: true };

      const endedAt = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.impersonationSession.update({
          where: { id: session.id },
          data: {
            endedAt,
            endReason: session.expiresAt <= endedAt ? 'EXPIRED' : 'EXITED',
          },
        });
        await this.logEnd(
          tx,
          { ...actor, userId: session.adminId, impersonatorId: null },
          session.id,
          session.targetUserId,
          'EXITED',
        );
      });
      return { id: session.id, endedAt, alreadyEnded: false };
    } catch (error) {
      catchServiceError(error);
    }
  }

  /** What the banner shows. Null when the current token is not an impersonation. */
  async current(user: RequestUser) {
    if (!user.impersonationSessionId) return { impersonating: false };
    const session = await this.prisma.impersonationSession.findUnique({
      where: { id: user.impersonationSessionId },
    });
    if (!session) return { impersonating: false };
    const [admin, target] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: session.adminId },
        select: { id: true, name: true, email: true },
      }),
      this.prisma.user.findUnique({
        where: { id: session.targetUserId },
        select: { id: true, name: true, role: true },
      }),
    ]);
    return {
      impersonating: true,
      readOnly: true,
      sessionId: session.id,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      admin,
      target,
    };
  }

  /**
   * Validates the session behind an impersonation token (called by JwtStrategy on every request):
   * it must exist, match the token, not be ended or expired, and its admin must still be an active ADMIN.
   */
  async assertActive(
    sessionId: string,
    adminId: string,
    targetUserId: string,
  ): Promise<boolean> {
    const session = await this.prisma.impersonationSession.findUnique({
      where: { id: sessionId },
      select: {
        adminId: true,
        targetUserId: true,
        endedAt: true,
        expiresAt: true,
      },
    });
    if (!session || session.endedAt || session.expiresAt <= new Date())
      return false;
    if (session.adminId !== adminId || session.targetUserId !== targetUserId)
      return false;
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { role: true, status: true },
    });
    return admin?.role === 'ADMIN' && admin.status === 'ACTIVE';
  }

  async list(
    page: number,
    limit: number,
    adminId?: string,
    targetUserId?: string,
  ) {
    const where: Prisma.ImpersonationSessionWhereInput = {
      ...(adminId ? { adminId } : {}),
      ...(targetUserId ? { targetUserId } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.impersonationSession.count({ where }),
      this.prisma.impersonationSession.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        ...skipTake(page, limit),
      }),
    ]);
    const ids = [...new Set(rows.flatMap((r) => [r.adminId, r.targetUserId]))];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, role: true },
        })
      : [];
    const find = (id: string) => users.find((u) => u.id === id) ?? { id };
    return paginate(
      rows.map((r) => ({
        ...r,
        admin: find(r.adminId),
        target: find(r.targetUserId),
      })),
      total,
      page,
      limit,
    );
  }

  private logEnd(
    tx: Prisma.TransactionClient,
    actor: Actor,
    sessionId: string,
    targetUserId: string,
    reason: string,
  ) {
    return this.audit.log(tx, {
      actor,
      action: AuditAction.IMPERSONATION_ENDED,
      entityType: AuditEntity.IMPERSONATION,
      entityId: sessionId,
      after: { endReason: reason, targetUserId },
    });
  }
}
