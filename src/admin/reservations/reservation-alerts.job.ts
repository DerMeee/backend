import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Notification } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import {
  NotificationsService,
  NotificationType,
} from '../../notifications/notifications.service';
import { AWAITING_CONFIRMATION } from '../../appointment/appointment-state';
import { DAY_MS, HOUR_MS } from '../../common/dates';
import { formatReservationRef } from '../../appointment/urgency';

/** Arbitrary constant id for the Postgres advisory lock (one runner at a time). */
const LOCK_ID = 74_031_101;
const BATCH = 500;
/** Overdue alerts only for visits in the last few days, not the whole history. */
const OVERDUE_LOOKBACK_MS = 7 * DAY_MS;

/**
 * Every 10 minutes, alerts admins about reservations that need attention:
 *  - visit within the urgent window and still not fully confirmed;
 *  - visit time passed and still not fully confirmed (overdue).
 * Candidates are picked by state, so a run missed during downtime catches up.
 * Each alert has a dedupe key: re-runs never notify twice for the same reservation.
 * Disable with DISABLE_SCHEDULED_JOBS=true (e.g. when running several API replicas).
 */
@Injectable()
export class ReservationAlertsJob {
  private readonly logger = new Logger(ReservationAlertsJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'reservation-alerts' })
  async handle() {
    if (process.env.DISABLE_SCHEDULED_JOBS === 'true') return;
    try {
      const created = await this.run(new Date());
      if (created.length)
        this.logger.log(`Sent ${created.length} reservation alert(s)`);
    } catch (e) {
      this.logger.error(
        `Reservation alerts failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /** Exposed for tests. Returns the notifications actually created. */
  async run(now: Date): Promise<Notification[]> {
    const t = await this.settings.get();
    const urgentEnd = new Date(now.getTime() + t.urgentHours * HOUR_MS);

    const created = await this.prisma.$transaction(
      async (tx) => {
        const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${LOCK_ID}) AS locked`;
        if (!locked) return [] as Notification[];

        const out: Notification[] = [];
        const select = {
          id: true,
          refNo: true,
          state: true,
          startAt: true,
          doctor: { select: { user: { select: { name: true } } } },
          patient: { select: { user: { select: { name: true } } } },
        } as const;

        const approaching = await tx.appointment.findMany({
          where: {
            state: { in: AWAITING_CONFIRMATION },
            startAt: { gte: now, lte: urgentEnd },
          },
          select,
          orderBy: { startAt: 'asc' },
          take: BATCH,
        });
        for (const a of approaching) {
          const waitingFor = a.state === 'PENDING' ? 'the doctor' : 'Dermee';
          out.push(
            ...(await this.notifications.notifyAdmins(tx, {
              type: NotificationType.RESERVATION_APPROACHING_UNCONFIRMED,
              content: `Reservation ${formatReservationRef(a.refNo)} (${a.patient.user.name} with Dr ${a.doctor.user.name}) starts ${a.startAt.toISOString().slice(0, 16).replace('T', ' ')} UTC and is still waiting for ${waitingFor}.`,
              entityType: 'Appointment',
              entityId: a.id,
              link: `/admin/reservations/${a.id}`,
              // One alert per reservation per state: a new alert if it moves PENDING → CONFIRMED.
              dedupeKey: `reservation:${a.id}:approaching:${a.state}`,
            })),
          );
        }

        const overdue = await tx.appointment.findMany({
          where: {
            state: { in: AWAITING_CONFIRMATION },
            startAt: {
              lt: now,
              gte: new Date(now.getTime() - OVERDUE_LOOKBACK_MS),
            },
          },
          select,
          orderBy: { startAt: 'asc' },
          take: BATCH,
        });
        for (const a of overdue) {
          out.push(
            ...(await this.notifications.notifyAdmins(tx, {
              type: NotificationType.RESERVATION_OVERDUE_UNCONFIRMED,
              content: `Overdue: reservation ${formatReservationRef(a.refNo)} (${a.patient.user.name} with Dr ${a.doctor.user.name}) was due ${a.startAt.toISOString().slice(0, 16).replace('T', ' ')} UTC and was never fully confirmed.`,
              entityType: 'Appointment',
              entityId: a.id,
              link: `/admin/reservations/${a.id}`,
              dedupeKey: `reservation:${a.id}:overdue`,
            })),
          );
        }
        return out;
      },
      { timeout: 60_000 },
    );

    this.notifications.publish(created);
    return created;
  }
}
