import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { catchServiceError } from '../../utils/catch-service-error';
import { endOfLocalDay, startOfLocalDay } from '../../common/dates';
import { paginate, resolveSort, skipTake } from '../../common/pagination';
import { andAll, likePattern, toInt } from '../../common/sql';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { AccountStatusService } from '../accounts/account-status.service';
import type { AdminClientsQueryDto } from './dto/admin-clients-query.dto';

interface ClientSqlRow {
  userId: string;
  patientId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phoneNumber: string | null;
  status: string;
  createdAt: Date;
  lastActivityAt: Date | null;
  wilaya: string | null;
  commune: string | null;
  reservations: number;
  completedReservations: number;
  cancelledReservations: number;
  noShowReservations: number;
  orders: number;
}

@Injectable()
export class AdminClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountStatusService,
  ) {}

  /**
   * Clients with reservation and order counters.
   * Counts are aggregated per patient in sub-queries, then joined; sorting by any counter is allowed.
   */
  async list(q: AdminClientsQueryDto) {
    try {
      const conditions: Prisma.Sql[] = [Prisma.sql`u."role" = 'PATIENT'`];
      if (q.status) conditions.push(Prisma.sql`u."status"::text = ${q.status}`);
      if (q.from)
        conditions.push(
          Prisma.sql`u."createdAt" >= ${startOfLocalDay(q.from)}`,
        );
      if (q.to)
        conditions.push(Prisma.sql`u."createdAt" <= ${endOfLocalDay(q.to)}`);
      if (q.search?.trim()) {
        const p = likePattern(q.search);
        const digits = likePattern(q.search.replace(/\s+/g, ''));
        conditions.push(Prisma.sql`(
          u."name" ILIKE ${p} OR u."firstName" ILIKE ${p} OR u."lastName" ILIKE ${p}
          OR u."email" ILIKE ${p} OR u."phoneNumber" ILIKE ${p} OR u."phoneNumber" ILIKE ${digits}
        )`);
      }
      if (q.wilaya?.trim())
        conditions.push(Prisma.sql`ad."state" ILIKE ${likePattern(q.wilaya)}`);
      if (q.commune?.trim())
        conditions.push(Prisma.sql`ad."city" ILIKE ${likePattern(q.commune)}`);
      const where = andAll(conditions);

      const dir = Prisma.raw(q.sortDir === 'asc' ? 'ASC' : 'DESC');
      const sortColumn = resolveSort(
        q.sortBy,
        {
          createdAt: Prisma.raw('u."createdAt"'),
          lastName: Prisma.raw('lower(coalesce(u."lastName", u."name"))'),
          firstName: Prisma.raw('lower(coalesce(u."firstName", u."name"))'),
          reservations: Prisma.raw('"reservations"'),
          completedReservations: Prisma.raw('"completedReservations"'),
          cancelledReservations: Prisma.raw('"cancelledReservations"'),
          orders: Prisma.raw('"orders"'),
          lastActivityAt: Prisma.raw('u."lastActivityAt"'),
        },
        'createdAt',
      );
      const { skip, take } = skipTake(q.page, q.limit);

      const [countRows, rows] = await Promise.all([
        this.prisma.$queryRaw<{ total: number }[]>`
          SELECT COUNT(*)::int AS total
          FROM "Patient" p
          JOIN "User" u ON u."id" = p."userId"
          LEFT JOIN "Address" ad ON ad."id" = u."addressId"
          WHERE ${where}`,
        this.prisma.$queryRaw<ClientSqlRow[]>`
          SELECT u."id" AS "userId", p."id" AS "patientId", u."name", u."firstName", u."lastName",
                 u."email", u."phoneNumber", u."status"::text AS "status", u."createdAt", u."lastActivityAt",
                 ad."state" AS "wilaya", ad."city" AS "commune",
                 COALESCE(ap."total", 0)::int AS "reservations",
                 COALESCE(ap."completed", 0)::int AS "completedReservations",
                 COALESCE(ap."cancelled", 0)::int AS "cancelledReservations",
                 COALESCE(ap."noShow", 0)::int AS "noShowReservations",
                 COALESCE(o."orders", 0)::int AS "orders"
          FROM "Patient" p
          JOIN "User" u ON u."id" = p."userId"
          LEFT JOIN "Address" ad ON ad."id" = u."addressId"
          LEFT JOIN (
            SELECT "patientId",
                   COUNT(*) AS "total",
                   COUNT(*) FILTER (WHERE "state"::text = 'COMPLETED') AS "completed",
                   COUNT(*) FILTER (WHERE "state"::text = 'CANCELLED') AS "cancelled",
                   COUNT(*) FILTER (WHERE "state"::text = 'NO_SHOW') AS "noShow"
            FROM "Appointment" GROUP BY "patientId"
          ) ap ON ap."patientId" = p."id"
          LEFT JOIN (
            SELECT "patientId", COUNT(*) AS "orders" FROM "Order" GROUP BY "patientId"
          ) o ON o."patientId" = p."id"
          WHERE ${where}
          ORDER BY ${sortColumn} ${dir} NULLS LAST, u."id" ${dir}
          LIMIT ${take} OFFSET ${skip}`,
      ]);

      const data = rows.map((r) => ({
        ...r,
        reservations: toInt(r.reservations),
        completedReservations: toInt(r.completedReservations),
        cancelledReservations: toInt(r.cancelledReservations),
        noShowReservations: toInt(r.noShowReservations),
        orders: toInt(r.orders),
        accountStatus: r.status,
      }));
      return paginate(data, toInt(countRows[0]?.total), q.page, q.limit);
    } catch (error) {
      catchServiceError(error);
    }
  }

  /** Client profile: identity, contact, location, activity, counters and status history. */
  async detail(userId: string) {
    try {
      const user = await this.prisma.user.findFirst({
        where: { id: userId, role: 'PATIENT' },
        select: {
          id: true,
          name: true,
          firstName: true,
          lastName: true,
          email: true,
          phoneNumber: true,
          profilePictureUrl: true,
          status: true,
          suspendedAt: true,
          suspendReason: true,
          createdAt: true,
          updatedAt: true,
          lastActivityAt: true,
          googleId: true,
          facebookId: true,
          address: true,
          patientProfile: {
            select: {
              id: true,
              _count: { select: { documents: true, orders: true } },
            },
          },
        },
      });
      if (!user || !user.patientProfile)
        throw new NotFoundException('Client not found');

      const byState = await this.prisma.appointment.groupBy({
        by: ['state'],
        where: { patientId: user.patientProfile.id },
        _count: { _all: true },
      });
      const reservationsByState = Object.fromEntries(
        byState.map((s) => [s.state, s._count._all]),
      );
      const { googleId, facebookId, patientProfile, ...rest } = user;

      return {
        ...rest,
        patientId: patientProfile.id,
        accountStatus: user.status,
        signInMethods: [
          ...(googleId ? ['GOOGLE'] : []),
          ...(facebookId ? ['FACEBOOK'] : []),
        ],
        wilaya: user.address?.state ?? null,
        commune: user.address?.city ?? null,
        stats: {
          reservations: byState.reduce((a, s) => a + s._count._all, 0),
          reservationsByState,
          orders: patientProfile._count.orders,
          documents: patientProfile._count.documents,
        },
        statusHistory: await this.accounts.historyFor(user.id),
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async reservations(userId: string, q: ListQueryDto) {
    try {
      const patient = await this.prisma.patient.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!patient) throw new NotFoundException('Client not found');
      const where: Prisma.AppointmentWhereInput = { patientId: patient.id };
      const [total, rows] = await Promise.all([
        this.prisma.appointment.count({ where }),
        this.prisma.appointment.findMany({
          where,
          orderBy: { startAt: q.sortDir },
          ...skipTake(q.page, q.limit),
          select: {
            id: true,
            refNo: true,
            state: true,
            type: true,
            visitMode: true,
            startAt: true,
            endAt: true,
            createdAt: true,
            doctor: {
              select: {
                id: true,
                specialty: true,
                user: { select: { id: true, name: true, phoneNumber: true } },
              },
            },
          },
        }),
      ]);
      return paginate(rows, total, q.page, q.limit);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async orders(userId: string, q: ListQueryDto) {
    try {
      const patient = await this.prisma.patient.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!patient) throw new NotFoundException('Client not found');
      const where: Prisma.OrderWhereInput = { patientId: patient.id };
      const [total, rows] = await Promise.all([
        this.prisma.order.count({ where }),
        this.prisma.order.findMany({
          where,
          orderBy: { createdAt: q.sortDir },
          ...skipTake(q.page, q.limit),
          include: { items: true },
        }),
      ]);
      return paginate(rows, total, q.page, q.limit);
    } catch (error) {
      catchServiceError(error);
    }
  }
}
