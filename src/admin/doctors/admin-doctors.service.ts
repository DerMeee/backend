import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { catchServiceError } from '../../utils/catch-service-error';
import { endOfLocalDay, startOfLocalDay } from '../../common/dates';
import { paginate, resolveSort, skipTake } from '../../common/pagination';
import { andAll, likePattern, toInt } from '../../common/sql';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { AccountStatusService } from '../accounts/account-status.service';
import {
  doctorDocumentSelect,
  doctorDocumentUrl,
} from '../../doctor/doctor-documents.controller';
import type { AdminDoctorsQueryDto } from './dto/admin-doctors-query.dto';

interface DoctorSqlRow {
  userId: string;
  doctorId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phoneNumber: string | null;
  specialty: string | null;
  street: string | null;
  wilaya: string | null;
  commune: string | null;
  userStatus: string;
  approvalStatus: string;
  approvedAt: Date | null;
  createdAt: Date;
  reservations: number;
  upcomingReservations: number;
  documents: number;
}

@Injectable()
export class AdminDoctorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountStatusService,
  ) {}

  async list(q: AdminDoctorsQueryDto) {
    try {
      const c: Prisma.Sql[] = [];
      if (q.status === 'SUSPENDED')
        c.push(Prisma.sql`u."status"::text = 'SUSPENDED'`);
      else if (q.status) {
        c.push(
          Prisma.sql`u."status"::text = 'ACTIVE' AND d."approvalStatus"::text = ${q.status}`,
        );
      }
      if (q.from)
        c.push(Prisma.sql`u."createdAt" >= ${startOfLocalDay(q.from)}`);
      if (q.to) c.push(Prisma.sql`u."createdAt" <= ${endOfLocalDay(q.to)}`);
      if (q.search?.trim()) {
        const p = likePattern(q.search);
        const digits = likePattern(q.search.replace(/\s+/g, ''));
        c.push(Prisma.sql`(
          u."name" ILIKE ${p} OR u."firstName" ILIKE ${p} OR u."lastName" ILIKE ${p}
          OR u."email" ILIKE ${p} OR u."phoneNumber" ILIKE ${p} OR u."phoneNumber" ILIKE ${digits}
        )`);
      }
      if (q.specialty?.trim())
        c.push(Prisma.sql`d."specialty" ILIKE ${likePattern(q.specialty)}`);
      if (q.wilaya?.trim())
        c.push(Prisma.sql`ad."state" ILIKE ${likePattern(q.wilaya)}`);
      if (q.commune?.trim())
        c.push(Prisma.sql`ad."city" ILIKE ${likePattern(q.commune)}`);
      const where = andAll(c);

      const dir = Prisma.raw(q.sortDir === 'asc' ? 'ASC' : 'DESC');
      const sortColumn = resolveSort(
        q.sortBy,
        {
          createdAt: Prisma.raw('u."createdAt"'),
          lastName: Prisma.raw('lower(coalesce(u."lastName", u."name"))'),
          firstName: Prisma.raw('lower(coalesce(u."firstName", u."name"))'),
          specialty: Prisma.raw('lower(d."specialty")'),
          reservations: Prisma.raw('"reservations"'),
          // Pending first when ascending: the review queue.
          status: Prisma.raw(
            `CASE WHEN u."status"::text = 'SUSPENDED' THEN 3 WHEN d."approvalStatus"::text = 'PENDING' THEN 0 WHEN d."approvalStatus"::text = 'REJECTED' THEN 2 ELSE 1 END`,
          ),
        },
        'createdAt',
      );
      const { skip, take } = skipTake(q.page, q.limit);
      const now = new Date();

      const from = Prisma.sql`
        FROM "Doctor" d
        JOIN "User" u ON u."id" = d."userId"
        LEFT JOIN "Address" ad ON ad."id" = u."addressId"`;

      const [countRows, rows] = await Promise.all([
        this.prisma.$queryRaw<
          { total: number }[]
        >`SELECT COUNT(*)::int AS total ${from} WHERE ${where}`,
        this.prisma.$queryRaw<DoctorSqlRow[]>`
          SELECT u."id" AS "userId", d."id" AS "doctorId", u."name", u."firstName", u."lastName",
                 u."email", u."phoneNumber", d."specialty",
                 ad."street", ad."state" AS "wilaya", ad."city" AS "commune",
                 u."status"::text AS "userStatus", d."approvalStatus"::text AS "approvalStatus",
                 d."approvedAt", u."createdAt",
                 COALESCE(ap."total", 0)::int AS "reservations",
                 COALESCE(ap."upcoming", 0)::int AS "upcomingReservations",
                 COALESCE(dd."documents", 0)::int AS "documents"
          ${from}
          LEFT JOIN (
            SELECT "doctorId", COUNT(*) AS "total",
                   COUNT(*) FILTER (
                     WHERE "startAt" >= ${now}
                       AND "state"::text IN ('PENDING', 'CONFIRMED', 'DERMEE_CONFIRMED')
                   ) AS "upcoming"
            FROM "Appointment" GROUP BY "doctorId"
          ) ap ON ap."doctorId" = d."id"
          LEFT JOIN (
            SELECT "doctorId", COUNT(*) AS "documents" FROM "DoctorDocument" GROUP BY "doctorId"
          ) dd ON dd."doctorId" = d."id"
          WHERE ${where}
          ORDER BY ${sortColumn} ${dir} NULLS LAST, u."id" ${dir}
          LIMIT ${take} OFFSET ${skip}`,
      ]);

      const data = rows.map((r) => ({
        ...r,
        reservations: toInt(r.reservations),
        upcomingReservations: toInt(r.upcomingReservations),
        documents: toInt(r.documents),
        status: r.userStatus === 'SUSPENDED' ? 'SUSPENDED' : r.approvalStatus,
        /** Which of the three row actions make sense now (the UI can disable the others). */
        actions: {
          approve:
            r.userStatus !== 'SUSPENDED' && r.approvalStatus !== 'APPROVED',
          reject:
            r.userStatus !== 'SUSPENDED' && r.approvalStatus === 'PENDING',
          suspend: r.userStatus === 'ACTIVE',
          reactivate: r.userStatus === 'SUSPENDED',
        },
      }));
      return paginate(data, toInt(countRows[0]?.total), q.page, q.limit);
    } catch (error) {
      catchServiceError(error);
    }
  }

  /** Doctor profile: personal + professional info, verification, approval history, reservation stats. */
  async detail(userId: string) {
    try {
      const user = await this.prisma.user.findFirst({
        where: { id: userId, role: 'DOCTOR' },
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
          lastActivityAt: true,
          address: true,
          doctorProfile: {
            select: {
              id: true,
              specialty: true,
              fees: true,
              workYears: true,
              about: true,
              approvalStatus: true,
              approvedAt: true,
              approvedById: true,
              rejectionReason: true,
              workDays: {
                select: { day: true, startTime: true, endTime: true },
                orderBy: { day: 'asc' },
              },
              documents: {
                select: doctorDocumentSelect,
                orderBy: { createdAt: 'desc' },
              },
            },
          },
        },
      });
      if (!user || !user.doctorProfile)
        throw new NotFoundException('Doctor not found');
      const doctor = user.doctorProfile;

      const [byState, upcoming, decidedBy] = await Promise.all([
        this.prisma.appointment.groupBy({
          by: ['state'],
          where: { doctorId: doctor.id },
          _count: { _all: true },
        }),
        this.prisma.appointment.count({
          where: {
            doctorId: doctor.id,
            startAt: { gte: new Date() },
            // Same definition as the list's upcomingReservations.
            state: { in: ['PENDING', 'CONFIRMED', 'DERMEE_CONFIRMED'] },
          },
        }),
        doctor.approvedById
          ? this.prisma.user.findUnique({
              where: { id: doctor.approvedById },
              select: { id: true, name: true, email: true },
            })
          : null,
      ]);

      const { doctorProfile: _d, ...rest } = user;
      return {
        ...rest,
        doctorId: doctor.id,
        wilaya: user.address?.state ?? null,
        commune: user.address?.city ?? null,
        professional: {
          specialty: doctor.specialty,
          fees: doctor.fees,
          workYears: doctor.workYears,
          about: doctor.about,
          workDays: doctor.workDays,
        },
        verification: {
          approvalStatus: doctor.approvalStatus,
          status:
            user.status === 'SUSPENDED' ? 'SUSPENDED' : doctor.approvalStatus,
          decidedAt: doctor.approvedAt,
          decidedBy,
          rejectionReason: doctor.rejectionReason,
          documents: doctor.documents.map((d) => ({
            ...d,
            url: doctorDocumentUrl(d.id),
          })),
        },
        stats: {
          reservations: byState.reduce((a, s) => a + s._count._all, 0),
          upcoming,
          reservationsByState: Object.fromEntries(
            byState.map((s) => [s.state, s._count._all]),
          ),
        },
        approvalHistory: await this.accounts.historyFor(user.id),
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async reservations(userId: string, q: ListQueryDto) {
    try {
      const doctor = await this.prisma.doctor.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!doctor) throw new NotFoundException('Doctor not found');
      const where: Prisma.AppointmentWhereInput = { doctorId: doctor.id };
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
            patient: {
              select: {
                id: true,
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

  async documents(userId: string) {
    const doctor = await this.prisma.doctor.findUnique({
      where: { userId },
      select: {
        documents: {
          select: doctorDocumentSelect,
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!doctor) throw new NotFoundException('Doctor not found');
    return doctor.documents.map((d) => ({
      ...d,
      url: doctorDocumentUrl(d.id),
    }));
  }
}
