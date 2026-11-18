import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/audit-actions';
import type { Actor } from '../common/request-user';
import { catchServiceError } from '../utils/catch-service-error';

export interface AppSettings {
  /** Appointment starts within this many hours → URGENT. */
  urgentHours: number;
  /** Appointment starts within this many hours → MEDIUM. */
  mediumHours: number;
  /** Default threshold for the low-stock alert when a product has none. */
  defaultLowStockThreshold: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  urgentHours: 24,
  mediumHours: 72,
  defaultLowStockThreshold: 5,
};

const CACHE_MS = 30_000;

export function validateSettings(s: AppSettings): void {
  const ints = Object.entries(s).filter(
    ([, v]) => !Number.isInteger(v) || (v as number) < 0,
  );
  if (ints.length) {
    throw new BadRequestException(
      `Settings must be non-negative integers: ${ints.map(([k]) => k).join(', ')}`,
    );
  }
  if (s.urgentHours < 1)
    throw new BadRequestException('urgentHours must be at least 1');
  if (s.mediumHours <= s.urgentHours) {
    throw new BadRequestException(
      'mediumHours must be greater than urgentHours',
    );
  }
}

@Injectable()
export class SettingsService {
  private cache: { value: AppSettings; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Current settings, defaults filled in. Cached briefly because it's read on every list request. */
  async get(): Promise<AppSettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS)
      return this.cache.value;
    const rows = await this.prisma.systemSetting.findMany();
    const value: AppSettings = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      if (row.key in value && typeof row.value === 'number') {
        (value as unknown as Record<string, number>)[row.key] = row.value;
      }
    }
    this.cache = { value, at: Date.now() };
    return value;
  }

  async update(
    patch: Partial<AppSettings>,
    actor: Actor,
  ): Promise<AppSettings> {
    try {
      const before = await this.get();
      const next: AppSettings = { ...before, ...patch };
      validateSettings(next);

      await this.prisma.$transaction(async (tx) => {
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) continue;
          await tx.systemSetting.upsert({
            where: { key },
            create: {
              key,
              value: value as Prisma.InputJsonValue,
              updatedById: actor.userId,
            },
            update: {
              value: value as Prisma.InputJsonValue,
              updatedById: actor.userId,
            },
          });
        }
        await this.audit.log(tx, {
          actor,
          action: AuditAction.SETTINGS_UPDATED,
          entityType: AuditEntity.SETTINGS,
          before,
          after: next,
        });
      });
      this.cache = null;
      return this.get();
    } catch (error) {
      catchServiceError(error);
    }
  }
}
