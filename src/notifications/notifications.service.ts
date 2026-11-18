import { Injectable, NotFoundException } from '@nestjs/common';
import { Notification, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { Db } from '../audit/audit.service';
import { paginate, skipTake } from '../common/pagination';
import { catchServiceError } from '../utils/catch-service-error';
import type { NotificationsQueryDto } from './dto/notifications-query.dto';

export const NotificationType = {
  GENERAL: 'GENERAL',
  DOCTOR_APPROVED: 'DOCTOR_APPROVED',
  DOCTOR_REJECTED: 'DOCTOR_REJECTED',
  DOCTOR_UNDER_REVIEW: 'DOCTOR_UNDER_REVIEW',
  DOCTOR_PENDING_APPROVAL: 'DOCTOR_PENDING_APPROVAL',
  RESERVATION_PENDING_DOCTOR: 'RESERVATION_PENDING_DOCTOR',
  RESERVATION_AWAITING_DERMEE: 'RESERVATION_AWAITING_DERMEE',
  RESERVATION_APPROACHING_UNCONFIRMED: 'RESERVATION_APPROACHING_UNCONFIRMED',
  RESERVATION_OVERDUE_UNCONFIRMED: 'RESERVATION_OVERDUE_UNCONFIRMED',
  RESERVATION_STATUS_CHANGED: 'RESERVATION_STATUS_CHANGED',
  ORDER_PLACED: 'ORDER_PLACED',
  ORDER_STATUS_CHANGED: 'ORDER_STATUS_CHANGED',
  LOW_STOCK: 'LOW_STOCK',
} as const;
export type NotificationType =
  (typeof NotificationType)[keyof typeof NotificationType];

export interface NotificationInput {
  type: NotificationType;
  content: string;
  entityType?: string;
  entityId?: string;
  link?: string;
  /** Same key + same user = created once only. */
  dedupeKey?: string;
}

/**
 * Notifications are written inside the caller's transaction (so they roll back with it)
 * and pushed over Socket.IO with `publish()` once the transaction has committed.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async notifyUser(
    db: Db,
    userId: string,
    input: NotificationInput,
  ): Promise<Notification[]> {
    return this.createMany(db, [userId], input);
  }

  /** One row per active administrator. */
  async notifyAdmins(
    db: Db,
    input: NotificationInput,
  ): Promise<Notification[]> {
    const admins = await db.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    return this.createMany(
      db,
      admins.map((a) => a.id),
      input,
    );
  }

  async createMany(
    db: Db,
    userIds: string[],
    input: NotificationInput,
  ): Promise<Notification[]> {
    if (userIds.length === 0) return [];
    // createManyAndReturn + skipDuplicates returns only rows actually inserted,
    // so re-running a scheduled check never pushes the same alert twice.
    return db.notification.createManyAndReturn({
      data: userIds.map((userId) => ({
        userId,
        type: input.type,
        content: input.content,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        link: input.link ?? null,
        dedupeKey: input.dedupeKey ?? null,
      })),
      skipDuplicates: true,
    });
  }

  /** Push freshly created notifications to their owners' sockets. Call after commit. */
  publish(rows: Notification[]) {
    for (const n of rows) this.realtime.emitToUser(n.userId, 'notification', n);
  }

  async list(userId: string, query: NotificationsQueryDto) {
    try {
      const where: Prisma.NotificationWhereInput = {
        userId,
        ...(query.unreadOnly ? { read: false } : {}),
        ...(query.type ? { type: query.type } : {}),
      };
      const [total, rows, unread] = await Promise.all([
        this.prisma.notification.count({ where }),
        this.prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          ...skipTake(query.page, query.limit),
        }),
        this.prisma.notification.count({ where: { userId, read: false } }),
      ]);
      return { ...paginate(rows, total, query.page, query.limit), unread };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async unreadCount(userId: string) {
    const unread = await this.prisma.notification.count({
      where: { userId, read: false },
    });
    return { unread };
  }

  async markRead(userId: string, id: string) {
    try {
      const res = await this.prisma.notification.updateMany({
        where: { id, userId },
        data: { read: true, readAt: new Date() },
      });
      if (res.count === 0)
        throw new NotFoundException('Notification not found');
      return { id, read: true };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async markAllRead(userId: string) {
    const res = await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true, readAt: new Date() },
    });
    return { updated: res.count };
  }
}
