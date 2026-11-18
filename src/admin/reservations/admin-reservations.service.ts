import { Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentState, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction, AuditEntity } from '../../audit/audit-actions';
import { SettingsService } from '../../settings/settings.service';
import { AppointmentService } from '../../appointment/appointment.service';
import {
  allowedTransitions,
  AWAITING_CONFIRMATION,
  BLOCKING_STATES,
  STATE_LABELS,
  type TransitionName,
} from '../../appointment/appointment-state';
import {
  computeUrgency,
  formatReservationRef,
  parseReservationRef,
  prioritySql,
  type UrgencyLevel,
  type UrgencyThresholds,
} from '../../appointment/urgency';
import type { Actor } from '../../common/request-user';
import { endOfLocalDay, HOUR_MS, startOfLocalDay } from '../../common/dates';
import { paginate, resolveSort, skipTake } from '../../common/pagination';
import { andAll, likePattern, toInt } from '../../common/sql';
import { catchServiceError } from '../../utils/catch-service-error';
import { addDays, countSeries, localToday } from '../stats/timeseries';
import type {
  AdminReservationsQueryDto,
  ReservationTimeseriesQueryDto,
} from './dto/admin-reservations-query.dto';

interface ReservationSqlRow {
  id: string;
  refNo: number;
  state: AppointmentState;
  type: string;
  visitMode: string;
  startAt: Date;
  endAt: Date;
  createdAt: Date;
  statusChangedAt: Date;
  clientUserId: string;
  clientName: string;
  clientPhone: string | null;
  clientWilaya: string | null;
  clientCommune: string | null;
  doctorUserId: string;
  doctorName: string;
  doctorPhone: string | null;
  doctorSpecialty: string | null;
}

const stateList = (states: AppointmentState[]) =>
  Prisma.join(states.map((s) => Prisma.sql`${s}`));

function personMatch(alias: 'pu' | 'du', text: string): Prisma.Sql {
  const u = Prisma.raw(alias);
  const p = likePattern(text);
  const digits = likePattern(text.replace(/\s+/g, ''));
  return Prisma.sql`(${u}."name" ILIKE ${p} OR ${u}."phoneNumber" ILIKE ${p} OR ${u}."phoneNumber" ILIKE ${digits})`;
}

/** SQL version of urgencyWhere() for the raw list query. */
function urgencySql(
  level: UrgencyLevel,
  now: Date,
  t: UrgencyThresholds,
): Prisma.Sql {
  const urgentEnd = new Date(now.getTime() + t.urgentHours * HOUR_MS);
  const mediumEnd = new Date(now.getTime() + t.mediumHours * HOUR_MS);
  const active = Prisma.sql`a."state"::text IN (${stateList(BLOCKING_STATES)})`;
  switch (level) {
    case 'OVERDUE':
      return Prisma.sql`(a."state"::text IN (${stateList(AWAITING_CONFIRMATION)}) AND a."startAt" < ${now})`;
    case 'URGENT':
      return Prisma.sql`(${active} AND a."startAt" >= ${now} AND a."startAt" <= ${urgentEnd})`;
    case 'MEDIUM':
      return Prisma.sql`(${active} AND a."startAt" > ${urgentEnd} AND a."startAt" <= ${mediumEnd})`;
    case 'NOT_URGENT':
      return Prisma.sql`(${active} AND a."startAt" > ${mediumEnd})`;
  }
}

@Injectable()
export class AdminReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appointments: AppointmentService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** KPI cards. */
  async stats() {
    try {
      const now = new Date();
      const t = await this.settings.get();
      const urgentEnd = new Date(now.getTime() + t.urgentHours * HOUR_MS);
      const [byState, upcoming, overdue, urgentUnconfirmed, needsOutcome] =
        await Promise.all([
          this.prisma.appointment.groupBy({
            by: ['state'],
            _count: { _all: true },
          }),
          this.prisma.appointment.count({
            where: { state: { in: BLOCKING_STATES }, startAt: { gte: now } },
          }),
          this.prisma.appointment.count({
            where: {
              state: { in: AWAITING_CONFIRMATION },
              startAt: { lt: now },
            },
          }),
          this.prisma.appointment.count({
            where: {
              state: { in: AWAITING_CONFIRMATION },
              startAt: { gte: now, lte: urgentEnd },
            },
          }),
          this.prisma.appointment.count({
            where: { state: 'DERMEE_CONFIRMED', startAt: { lt: now } },
          }),
        ]);
      const count = (s: AppointmentState) =>
        byState.find((r) => r.state === s)?._count._all ?? 0;
      return {
        totalReservations: byState.reduce((a, r) => a + r._count._all, 0),
        pendingDoctorConfirmation: count('PENDING'),
        confirmedByDoctor: count('CONFIRMED'),
        confirmedByDermee: count('DERMEE_CONFIRMED'),
        upcoming,
        cancelled: count('CANCELLED'),
        rejected: count('REJECTED'),
        completed: count('COMPLETED'),
        noShow: count('NO_SHOW'),
        /** Needs immediate attention: visit time passed, never fully confirmed. */
        overdueUnconfirmed: overdue,
        /** Within the urgent window and still unconfirmed. */
        urgentUnconfirmed,
        /** Fully confirmed, visit time passed, outcome not recorded yet. */
        awaitingOutcome: needsOutcome,
        thresholds: { urgentHours: t.urgentHours, mediumHours: t.mediumHours },
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  /** Reservation activity chart. */
  async timeseries(q: ReservationTimeseriesQueryDto) {
    try {
      const to = q.to ?? localToday();
      const from = q.from ?? addDays(to, -29);
      const series = await countSeries(this.prisma, {
        table: 'Appointment',
        dateColumn: q.dateField,
        granularity: q.granularity,
        from,
        to,
        splits: {
          pending: Prisma.sql`"state"::text = 'PENDING'`,
          confirmedByDoctor: Prisma.sql`"state"::text = 'CONFIRMED'`,
          confirmedByDermee: Prisma.sql`"state"::text = 'DERMEE_CONFIRMED'`,
          completed: Prisma.sql`"state"::text = 'COMPLETED'`,
          cancelled: Prisma.sql`"state"::text = 'CANCELLED'`,
          rejected: Prisma.sql`"state"::text = 'REJECTED'`,
          noShow: Prisma.sql`"state"::text = 'NO_SHOW'`,
        },
      });
      const total = series.reduce((a, p) => a + p.total, 0);
      return {
        granularity: q.granularity,
        dateField: q.dateField,
        from,
        to,
        total,
        series,
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async list(q: AdminReservationsQueryDto) {
    try {
      const now = new Date();
      const t = await this.settings.get();
      const c: Prisma.Sql[] = [];
      if (q.createdFrom)
        c.push(Prisma.sql`a."createdAt" >= ${startOfLocalDay(q.createdFrom)}`);
      if (q.createdTo)
        c.push(Prisma.sql`a."createdAt" <= ${endOfLocalDay(q.createdTo)}`);
      if (q.appointmentFrom)
        c.push(
          Prisma.sql`a."startAt" >= ${startOfLocalDay(q.appointmentFrom)}`,
        );
      if (q.appointmentTo)
        c.push(Prisma.sql`a."startAt" <= ${endOfLocalDay(q.appointmentTo)}`);
      if (q.client?.trim()) c.push(personMatch('pu', q.client));
      if (q.doctor?.trim()) c.push(personMatch('du', q.doctor));
      if (q.wilaya?.trim()) {
        const p = likePattern(q.wilaya);
        c.push(Prisma.sql`(pa."state" ILIKE ${p} OR da."state" ILIKE ${p})`);
      }
      if (q.commune?.trim()) {
        const p = likePattern(q.commune);
        c.push(Prisma.sql`(pa."city" ILIKE ${p} OR da."city" ILIKE ${p})`);
      }
      if (q.status?.length)
        c.push(Prisma.sql`a."state"::text IN (${stateList(q.status)})`);
      if (q.urgency) c.push(urgencySql(q.urgency, now, t));
      if (q.search?.trim()) {
        const ref = parseReservationRef(q.search);
        c.push(
          ref !== null
            ? Prisma.sql`(a."refNo" = ${ref} OR ${personMatch('pu', q.search)} OR ${personMatch('du', q.search)})`
            : Prisma.sql`(${personMatch('pu', q.search)} OR ${personMatch('du', q.search)})`,
        );
      }
      const where = andAll(c);

      const dir = Prisma.raw(q.sortDir === 'asc' ? 'ASC' : 'DESC');
      const sortBy =
        q.sortBy && q.sortBy in { startAt: 1, createdAt: 1, statusChangedAt: 1 }
          ? q.sortBy
          : 'priority';
      const orderBy =
        sortBy === 'priority'
          ? // Most urgent first, then the soonest appointment.
            Prisma.sql`${prioritySql(now, t)} ASC, a."startAt" ASC, a."id" ASC`
          : Prisma.sql`${resolveSort(
              sortBy,
              {
                startAt: Prisma.raw('a."startAt"'),
                createdAt: Prisma.raw('a."createdAt"'),
                statusChangedAt: Prisma.raw('a."statusChangedAt"'),
              },
              'startAt',
            )} ${dir}, a."id" ${dir}`;

      const from = Prisma.sql`
        FROM "Appointment" a
        JOIN "Patient" p ON p."id" = a."patientId"
        JOIN "User" pu ON pu."id" = p."userId"
        LEFT JOIN "Address" pa ON pa."id" = pu."addressId"
        JOIN "Doctor" d ON d."id" = a."doctorId"
        JOIN "User" du ON du."id" = d."userId"
        LEFT JOIN "Address" da ON da."id" = du."addressId"`;
      const { skip, take } = skipTake(q.page, q.limit);

      const [countRows, rows] = await Promise.all([
        this.prisma.$queryRaw<
          { total: number }[]
        >`SELECT COUNT(*)::int AS total ${from} WHERE ${where}`,
        this.prisma.$queryRaw<ReservationSqlRow[]>`
          SELECT a."id", a."refNo", a."state"::text AS "state", a."type", a."visitMode"::text AS "visitMode",
                 a."startAt", a."endAt", a."createdAt", a."statusChangedAt",
                 pu."id" AS "clientUserId", pu."name" AS "clientName", pu."phoneNumber" AS "clientPhone",
                 pa."state" AS "clientWilaya", pa."city" AS "clientCommune",
                 du."id" AS "doctorUserId", du."name" AS "doctorName", du."phoneNumber" AS "doctorPhone",
                 d."specialty" AS "doctorSpecialty"
          ${from}
          WHERE ${where}
          ORDER BY ${orderBy}
          LIMIT ${take} OFFSET ${skip}`,
      ]);

      const data = rows.map((r) => ({
        id: r.id,
        reference: formatReservationRef(toInt(r.refNo)),
        client: {
          userId: r.clientUserId,
          name: r.clientName,
          phoneNumber: r.clientPhone,
          wilaya: r.clientWilaya,
          commune: r.clientCommune,
        },
        doctor: {
          userId: r.doctorUserId,
          name: r.doctorName,
          phoneNumber: r.doctorPhone,
          specialty: r.doctorSpecialty,
        },
        createdAt: r.createdAt,
        startAt: r.startAt,
        endAt: r.endAt,
        type: r.type,
        visitMode: r.visitMode,
        state: r.state,
        stateLabel: STATE_LABELS[r.state],
        statusChangedAt: r.statusChangedAt,
        urgency: computeUrgency(r.startAt, r.state, now, t),
      }));
      return {
        ...paginate(data, toInt(countRows[0]?.total), q.page, q.limit),
        thresholds: { urgentHours: t.urgentHours, mediumHours: t.mediumHours },
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async detail(id: string) {
    try {
      const a = await this.prisma.appointment.findUnique({
        where: { id },
        include: {
          patient: {
            select: {
              id: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  phoneNumber: true,
                  status: true,
                  address: true,
                },
              },
            },
          },
          doctor: {
            select: {
              id: true,
              specialty: true,
              approvalStatus: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phoneNumber: true,
                  status: true,
                  address: true,
                },
              },
            },
          },
          history: { orderBy: { createdAt: 'asc' } },
          adminNotes: { orderBy: { createdAt: 'desc' } },
        },
      });
      if (!a) throw new NotFoundException('Reservation not found');

      const now = new Date();
      const t = await this.settings.get();
      const peopleIds = [
        ...new Set(
          [
            ...a.history.map((h) => h.actorId),
            ...a.adminNotes.map((n) => n.authorId),
            a.cancelledById,
          ].filter((x): x is string => !!x),
        ),
      ];
      const people = peopleIds.length
        ? await this.prisma.user.findMany({
            where: { id: { in: peopleIds } },
            select: { id: true, name: true, role: true },
          })
        : [];
      const who = (uid: string | null) =>
        uid ? (people.find((p) => p.id === uid) ?? { id: uid }) : null;

      return {
        id: a.id,
        reference: formatReservationRef(a.refNo),
        state: a.state,
        stateLabel: STATE_LABELS[a.state],
        type: a.type,
        visitMode: a.visitMode,
        startAt: a.startAt,
        endAt: a.endAt,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        statusChangedAt: a.statusChangedAt,
        meetLink: a.meetLink,
        cancelReason: a.cancelReason,
        cancelledBy: who(a.cancelledById),
        urgency: computeUrgency(a.startAt, a.state, now, t),
        client: {
          patientId: a.patient.id,
          ...a.patient.user,
          wilaya: a.patient.user.address?.state ?? null,
          commune: a.patient.user.address?.city ?? null,
        },
        doctor: {
          doctorId: a.doctor.id,
          specialty: a.doctor.specialty,
          approvalStatus: a.doctor.approvalStatus,
          ...a.doctor.user,
          wilaya: a.doctor.user.address?.state ?? null,
          commune: a.doctor.user.address?.city ?? null,
        },
        history: a.history.map((h) => ({
          ...h,
          fromLabel: h.fromState ? STATE_LABELS[h.fromState] : null,
          toLabel: STATE_LABELS[h.toState],
          actor: who(h.actorId),
        })),
        adminNotes: a.adminNotes.map((n) => ({
          ...n,
          author: who(n.authorId),
        })),
        /** Admin buttons to show: dermeeConfirm, complete, noShow, cancel. */
        allowedActions: allowedTransitions(a.state, 'ADMIN', a.startAt, now),
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  /** Admin lifecycle action. Business rules live in appointment-state.ts; nothing is bypassed here. */
  async act(
    id: string,
    name: Extract<
      TransitionName,
      'dermeeConfirm' | 'complete' | 'noShow' | 'cancel'
    >,
    actor: Actor,
    note?: string,
  ) {
    try {
      const appt = await this.appointments.load(id);
      await this.appointments.transition(appt, name, actor, note);
      return this.detail(id);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async addNote(id: string, content: string, actor: Actor) {
    try {
      const exists = await this.prisma.appointment.findUnique({
        where: { id },
        select: { id: true, refNo: true },
      });
      if (!exists) throw new NotFoundException('Reservation not found');
      const note = await this.prisma.$transaction(async (tx) => {
        const created = await tx.appointmentAdminNote.create({
          data: {
            appointmentId: id,
            authorId: actor.userId!,
            content: content.trim(),
          },
        });
        await this.audit.log(tx, {
          actor,
          action: AuditAction.RESERVATION_NOTE_ADDED,
          entityType: AuditEntity.APPOINTMENT,
          entityId: id,
          after: { noteId: created.id },
          metadata: { reference: formatReservationRef(exists.refNo) },
        });
        return created;
      });
      return note;
    } catch (error) {
      catchServiceError(error);
    }
  }
}
