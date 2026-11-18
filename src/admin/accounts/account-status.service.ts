import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DoctorApprovalStatus, Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction, AuditEntity } from '../../audit/audit-actions';
import type { Actor } from '../../common/request-user';
import { RealtimeService } from '../../realtime/realtime.service';
import {
  NotificationsService,
  NotificationType,
} from '../../notifications/notifications.service';
import { catchServiceError } from '../../utils/catch-service-error';

/** Allowed doctor approval moves. Suspension is separate (User.status). */
const APPROVAL_TRANSITIONS: Record<
  'approve' | 'reject' | 'reReview',
  { from: DoctorApprovalStatus[]; to: DoctorApprovalStatus; action: string }
> = {
  approve: {
    from: ['PENDING', 'REJECTED'],
    to: 'APPROVED',
    action: AuditAction.DOCTOR_APPROVED,
  },
  reject: {
    from: ['PENDING'],
    to: 'REJECTED',
    action: AuditAction.DOCTOR_REJECTED,
  },
  reReview: {
    from: ['REJECTED'],
    to: 'PENDING',
    action: AuditAction.DOCTOR_RE_REVIEW,
  },
};

/** Status shown in admin tables: suspension wins over the approval state. */
export function displayStatus(
  status: UserStatus,
  role: string,
  approval?: DoctorApprovalStatus | null,
): 'ACTIVE' | 'SUSPENDED' | 'PENDING' | 'REJECTED' {
  if (status === 'SUSPENDED') return 'SUSPENDED';
  if (role === 'DOCTOR' && approval && approval !== 'APPROVED') return approval;
  return 'ACTIVE';
}

@Injectable()
export class AccountStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
  ) {}

  async suspend(userId: string, reason: string, actor: Actor) {
    try {
      const user = await this.loadTarget(userId, actor);
      if (user.status === 'SUSPENDED')
        throw new ConflictException('Account is already suspended');

      await this.prisma.$transaction(async (tx) => {
        // Conditional update: a concurrent change makes this a no-op instead of a double write.
        const res = await tx.user.updateMany({
          where: { id: userId, status: 'ACTIVE' },
          data: {
            status: 'SUSPENDED',
            suspendedAt: new Date(),
            suspendReason: reason,
          },
        });
        if (res.count === 0)
          throw new ConflictException('Account status changed meanwhile');
        await this.history(
          tx,
          userId,
          'STATUS',
          'ACTIVE',
          'SUSPENDED',
          actor,
          reason,
        );
        await this.audit.log(tx, {
          actor,
          action: AuditAction.USER_SUSPENDED,
          entityType: AuditEntity.USER,
          entityId: userId,
          before: { status: 'ACTIVE' },
          after: { status: 'SUSPENDED', reason },
        });
      });
      // Existing access tokens are rejected by JwtStrategy from now on; close live sockets too.
      this.realtime.disconnectUser(userId);
      return this.summary(userId);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async reactivate(userId: string, reason: string | undefined, actor: Actor) {
    try {
      const user = await this.loadTarget(userId, actor);
      if (user.status === 'ACTIVE')
        throw new ConflictException('Account is already active');

      await this.prisma.$transaction(async (tx) => {
        const res = await tx.user.updateMany({
          where: { id: userId, status: 'SUSPENDED' },
          data: { status: 'ACTIVE', suspendedAt: null, suspendReason: null },
        });
        if (res.count === 0)
          throw new ConflictException('Account status changed meanwhile');
        await this.history(
          tx,
          userId,
          'STATUS',
          'SUSPENDED',
          'ACTIVE',
          actor,
          reason,
        );
        await this.audit.log(tx, {
          actor,
          action: AuditAction.USER_REACTIVATED,
          entityType: AuditEntity.USER,
          entityId: userId,
          before: { status: 'SUSPENDED', reason: user.suspendReason },
          after: { status: 'ACTIVE', reason },
        });
      });
      return this.summary(userId);
    } catch (error) {
      catchServiceError(error);
    }
  }

  approveDoctor(userId: string, note: string | undefined, actor: Actor) {
    return this.changeApproval(userId, 'approve', note, actor);
  }

  rejectDoctor(userId: string, reason: string, actor: Actor) {
    return this.changeApproval(userId, 'reject', reason, actor);
  }

  reReviewDoctor(userId: string, note: string | undefined, actor: Actor) {
    return this.changeApproval(userId, 'reReview', note, actor);
  }

  private async changeApproval(
    userId: string,
    kind: keyof typeof APPROVAL_TRANSITIONS,
    reason: string | undefined,
    actor: Actor,
  ) {
    try {
      const rule = APPROVAL_TRANSITIONS[kind];
      const doctor = await this.prisma.doctor.findUnique({
        where: { userId },
        select: { id: true, approvalStatus: true },
      });
      if (!doctor) throw new NotFoundException('Doctor not found');
      if (!rule.from.includes(doctor.approvalStatus)) {
        throw new BadRequestException(
          `Cannot ${kind === 'reReview' ? 're-review' : kind} a doctor whose status is ${doctor.approvalStatus}`,
        );
      }

      const created = await this.prisma.$transaction(async (tx) => {
        const res = await tx.doctor.updateMany({
          where: { id: doctor.id, approvalStatus: doctor.approvalStatus },
          data: {
            approvalStatus: rule.to,
            approvedAt: new Date(),
            approvedById: actor.userId,
            rejectionReason: rule.to === 'REJECTED' ? reason : null,
          },
        });
        if (res.count === 0)
          throw new ConflictException('Approval status changed meanwhile');
        await this.history(
          tx,
          userId,
          'APPROVAL',
          doctor.approvalStatus,
          rule.to,
          actor,
          reason,
        );
        await this.audit.log(tx, {
          actor,
          action: rule.action as (typeof AuditAction)[keyof typeof AuditAction],
          entityType: AuditEntity.DOCTOR,
          entityId: doctor.id,
          before: { approvalStatus: doctor.approvalStatus },
          after: { approvalStatus: rule.to, reason },
          metadata: { userId },
        });
        return this.notifications.notifyUser(tx, userId, {
          type:
            rule.to === 'APPROVED'
              ? NotificationType.DOCTOR_APPROVED
              : rule.to === 'REJECTED'
                ? NotificationType.DOCTOR_REJECTED
                : NotificationType.DOCTOR_UNDER_REVIEW,
          content:
            rule.to === 'APPROVED'
              ? 'Your Dermee doctor account has been approved. Patients can now book with you.'
              : rule.to === 'REJECTED'
                ? `Your Dermee doctor account was not approved${reason ? `: ${reason}` : '.'}`
                : 'Your Dermee doctor account is under review again.',
          entityType: 'Doctor',
          entityId: doctor.id,
        });
      });
      this.notifications.publish(created);
      return this.summary(userId);
    } catch (error) {
      catchServiceError(error);
    }
  }

  /** Admins can't be suspended through the API, and nobody can act on their own account. */
  private async loadTarget(userId: string, actor: Actor) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true, suspendReason: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.id === actor.userId)
      throw new ForbiddenException('You cannot change your own account status');
    if (user.role === 'ADMIN')
      throw new ForbiddenException(
        'Administrator accounts cannot be changed here',
      );
    return user;
  }

  private history(
    tx: Prisma.TransactionClient,
    userId: string,
    field: 'STATUS' | 'APPROVAL',
    fromValue: string,
    toValue: string,
    actor: Actor,
    reason?: string,
  ) {
    return tx.accountStatusHistory.create({
      data: {
        userId,
        field,
        fromValue,
        toValue,
        actorId: actor.userId,
        reason: reason ?? null,
      },
    });
  }

  async summary(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        status: true,
        suspendedAt: true,
        suspendReason: true,
        doctorProfile: {
          select: {
            approvalStatus: true,
            approvedAt: true,
            approvedById: true,
            rejectionReason: true,
          },
        },
      },
    });
    return {
      ...user,
      accountStatus: displayStatus(
        user.status,
        user.role,
        user.doctorProfile?.approvalStatus,
      ),
    };
  }

  /** Approval / suspension history of one account, newest first, with admin names. */
  async historyFor(userId: string) {
    const rows = await this.prisma.accountStatusHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const actorIds = [
      ...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x)),
    ];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    return rows.map((r) => ({
      ...r,
      actor: actors.find((a) => a.id === r.actorId) ?? null,
    }));
  }
}
