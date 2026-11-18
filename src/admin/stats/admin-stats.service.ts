import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { catchServiceError } from '../../utils/catch-service-error';
import { startOfLocalDay } from '../../common/dates';
import {
  addDays,
  countSeries,
  localToday,
  percentChange,
  previousPeriod,
} from './timeseries';
import { TimeseriesQueryDto } from './dto/timeseries-query.dto';

/** Admins are staff, not "registered users": every registration statistic excludes them. */
const REGISTERED_ROLES: UserRole[] = ['PATIENT', 'DOCTOR'];

@Injectable()
export class AdminStatsService {
  constructor(private readonly prisma: PrismaService) {}

  /** KPI cards at the top of the registration dashboard. */
  async registrationKpis() {
    try {
      const today = localToday();
      const monthStart = startOfLocalDay(`${today.slice(0, 7)}-01`);
      const prevMonthStart = startOfLocalDay(
        new Date(
          Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1),
        )
          .toISOString()
          .slice(0, 10),
      );

      const [byRole, pendingDoctors, newThisMonth, newLastMonth, suspended] =
        await Promise.all([
          this.prisma.user.groupBy({
            by: ['role'],
            where: { role: { in: REGISTERED_ROLES } },
            _count: { _all: true },
          }),
          this.prisma.doctor.count({
            where: { approvalStatus: 'PENDING', user: { status: 'ACTIVE' } },
          }),
          this.prisma.user.count({
            where: {
              role: { in: REGISTERED_ROLES },
              createdAt: { gte: monthStart },
            },
          }),
          this.prisma.user.count({
            where: {
              role: { in: REGISTERED_ROLES },
              createdAt: { gte: prevMonthStart, lt: monthStart },
            },
          }),
          this.prisma.user.count({
            where: { role: { in: REGISTERED_ROLES }, status: 'SUSPENDED' },
          }),
        ]);

      const count = (role: UserRole) =>
        byRole.find((r) => r.role === role)?._count._all ?? 0;
      const totalClients = count('PATIENT');
      const totalDoctors = count('DOCTOR');
      return {
        totalUsers: totalClients + totalDoctors,
        totalClients,
        totalDoctors,
        pendingDoctorApprovals: pendingDoctors,
        newRegistrationsThisMonth: newThisMonth,
        newRegistrationsLastMonth: newLastMonth,
        newRegistrationsChangePct: percentChange(newThisMonth, newLastMonth),
        suspendedUsers: suspended,
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  /** Registration chart: clients vs doctors per day/week/month, with the previous period for comparison. */
  async registrationTimeseries(query: TimeseriesQueryDto) {
    try {
      const to = query.to ?? localToday();
      const from = query.from ?? addDays(to, -29);
      const roleWhere = query.role
        ? Prisma.sql`"role" = ${query.role}::"UserRole"`
        : Prisma.sql`"role" IN ('PATIENT', 'DOCTOR')`;

      const series = await countSeries(this.prisma, {
        table: 'User',
        dateColumn: 'createdAt',
        granularity: query.granularity,
        from,
        to,
        where: roleWhere,
        splits: {
          clients: Prisma.sql`"role" = 'PATIENT'`,
          doctors: Prisma.sql`"role" = 'DOCTOR'`,
        },
      });

      const sum = (key: 'clients' | 'doctors' | 'total') =>
        series.reduce((acc, p) => acc + Number(p[key]), 0);
      const totals = {
        clients: sum('clients'),
        doctors: sum('doctors'),
        total: sum('total'),
      };

      const prev = previousPeriod(from, to);
      const roles: UserRole[] = query.role ? [query.role] : REGISTERED_ROLES;
      const prevByRole = await this.prisma.user.groupBy({
        by: ['role'],
        where: {
          role: { in: roles },
          createdAt: {
            gte: startOfLocalDay(prev.from),
            lt: startOfLocalDay(from),
          },
        },
        _count: { _all: true },
      });
      const prevCount = (role: UserRole) =>
        prevByRole.find((r) => r.role === role)?._count._all ?? 0;
      const previous = {
        ...prev,
        clients: prevCount('PATIENT'),
        doctors: prevCount('DOCTOR'),
        total: prevCount('PATIENT') + prevCount('DOCTOR'),
      };

      return {
        granularity: query.granularity,
        from,
        to,
        series,
        totals,
        previous,
        change: {
          totalPct: percentChange(totals.total, previous.total),
          clientsPct: percentChange(totals.clients, previous.clients),
          doctorsPct: percentChange(totals.doctors, previous.doctors),
        },
      };
    } catch (error) {
      catchServiceError(error);
    }
  }
}
