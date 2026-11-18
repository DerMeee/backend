import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../common/request-user';
import type { AuditAction, AuditEntity } from './audit-actions';
import { catchServiceError } from '../utils/catch-service-error';
import { paginate, skipTake } from '../common/pagination';
import { dateRangeFilter } from '../common/dates';
import type { AuditLogQueryDto } from './dto/audit-log-query.dto';

/** Prisma client or an interactive transaction client. */
export type Db = PrismaService | Prisma.TransactionClient;

export interface AuditEntry {
  actor: Actor;
  action: AuditAction;
  entityType: AuditEntity;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

const SECRET_KEYS = new Set([
  'passwordHash',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'googleId',
  'facebookId',
]);

/** Removes secrets and turns Dates into strings so the value fits a JSON column. */
export function sanitizeForAudit(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[truncated]';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.map((v) => sanitizeForAudit(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(k)) continue;
      out[k] = sanitizeForAudit(v, depth + 1);
    }
    return out;
  }
  return value;
}

function toJson(value: unknown) {
  if (value === undefined || value === null) return Prisma.DbNull;
  return sanitizeForAudit(value) as Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes one audit row. Pass the transaction client so the log is committed
   * (or rolled back) together with the change it describes.
   */
  async log(db: Db, entry: AuditEntry): Promise<void> {
    await db.auditLog.create({
      data: {
        actorId: entry.actor.userId,
        actorEmail: entry.actor.email ?? null,
        impersonatorId: entry.actor.impersonatorId ?? null,
        ip: entry.actor.ip ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: toJson(entry.before),
        after: toJson(entry.after),
        metadata: toJson(entry.metadata),
      },
    });
  }

  async list(query: AuditLogQueryDto) {
    try {
      const where: Prisma.AuditLogWhereInput = {
        actorId: query.actorId,
        action: query.action,
        entityType: query.entityType,
        entityId: query.entityId,
        createdAt: dateRangeFilter(query.from, query.to),
      };
      const [total, rows] = await Promise.all([
        this.prisma.auditLog.count({ where }),
        this.prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: query.sortDir === 'asc' ? 'asc' : 'desc' },
          ...skipTake(query.page, query.limit),
        }),
      ]);
      return paginate(rows, total, query.page, query.limit);
    } catch (error) {
      catchServiceError(error);
    }
  }

  /** History of one entity, newest first (used by detail pages). */
  async forEntity(entityType: AuditEntity, entityId: string, take = 50) {
    return this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
