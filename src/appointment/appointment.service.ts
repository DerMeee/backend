import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentState,
  Notification,
  Prisma,
  VisitMode,
  WeekDay,
} from '@prisma/client';
import { catchServiceError } from '../utils/catch-service-error';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { GetAppointmentsQueryDto } from './dto/get-appointments-query.dto';
import { DoctorAppointmentDto } from './dto/doctor-appointment.dto';
import { PatientAppointmentDto } from './dto/patient-appointment.dto';
import { ApproveAppointmentDto } from './dto/approve-appointment.dto';
import { RejectAppointmentDto } from './dto/reject-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { AppointmentResponseDto } from './dto/appointment-response.dto';
import { AppointmentDetailDto } from './dto/appointment-detail.dto';
import { PrismaService } from '../prisma/prisma.service';
import { PaginatedResponseDto } from './dto/pagination-resp.dto';
import { ResponseDto } from './dto/response.dto';
import { GoogleCalendarService } from '../google/google-calendar.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/audit-actions';
import {
  NotificationsService,
  NotificationType,
} from '../notifications/notifications.service';
import type { Actor } from '../common/request-user';
import { bookableDoctorWhere } from '../doctor/doctor-visibility';
import {
  type ActorRole,
  allowedTransitions,
  assertTransition,
  BLOCKING_STATES,
  type TransitionName,
} from './appointment-state';
import { formatReservationRef } from './urgency';

const WEEK_DAYS: WeekDay[] = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];

/** Everything the transition logic and notifications need about a reservation. */
const transitionInclude = {
  doctor: {
    select: {
      id: true,
      userId: true,
      user: { select: { name: true, email: true } },
    },
  },
  patient: {
    select: {
      id: true,
      userId: true,
      user: { select: { name: true, email: true } },
    },
  },
} satisfies Prisma.AppointmentInclude;

type AppointmentWithParties = Prisma.AppointmentGetPayload<{
  include: typeof transitionInclude;
}>;

/** "HH:mm" → minutes since midnight. */
function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Times are handled in UTC, like the slot list in DoctorService.getDoctorSchedule
 * (the production container runs in UTC). Clients send/receive UTC times.
 */
function utcMinutes(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function utcDayStart(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function parseHHmm(value: string, label: string): { h: number; m: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value ?? '');
  if (!match)
    throw new BadRequestException(`Invalid ${label} format, expected HH:mm`);
  return { h: Number(match[1]), m: Number(match[2]) };
}

function atUtc(date: string | Date, hhmm: string, label: string): Date {
  const { h, m } = parseHHmm(hhmm, label);
  const d = new Date(
    typeof date === 'string' ? `${date.slice(0, 10)}T00:00:00.000Z` : date,
  );
  if (Number.isNaN(d.getTime()))
    throw new BadRequestException('Invalid date, expected YYYY-MM-DD');
  d.setUTCHours(h, m, 0, 0);
  return d;
}

@Injectable()
export class AppointmentService {
  private readonly logger = new Logger(AppointmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleCalendar: GoogleCalendarService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Booking
  // ---------------------------------------------------------------------------

  async create(
    createAppointmentDto: CreateAppointmentDto,
    currentUserId: string,
  ): Promise<ResponseDto> {
    try {
      const { doctorUserId, date, time, durationMinutes, type, visitMode } =
        createAppointmentDto;
      if (!doctorUserId || !date || !time) {
        throw new BadRequestException(
          'doctorUserId, date and time are required',
        );
      }

      const startAt = atUtc(new Date(date), time, 'time');
      if (startAt < new Date()) {
        throw new BadRequestException('Cannot book past dates');
      }
      const minutes =
        durationMinutes && durationMinutes > 0 ? durationMinutes : 30;
      if (minutes > 8 * 60)
        throw new BadRequestException('Duration is too long');
      const endAt = new Date(startAt.getTime() + minutes * 60_000);

      // Resolve patient and doctor domain ids (Patient.id, Doctor.id) from User.id.
      // Only approved, active doctors can be booked.
      const [patient, doctor] = await Promise.all([
        this.prisma.patient.findUnique({ where: { userId: currentUserId } }),
        this.prisma.doctor.findFirst({
          where: { userId: doctorUserId, ...bookableDoctorWhere },
        }),
      ]);
      if (!patient)
        throw new ForbiddenException('Only a patient can create appointments');
      if (!doctor) throw new BadRequestException('Doctor not found');

      let alerts: Notification[] = [];
      const created = await this.prisma.$transaction(async (tx) => {
        // One booking at a time per doctor: closes the race where two patients
        // grab the same slot between the check and the insert.
        await this.lockDoctor(tx, doctor.id);
        const problem = await this.slotProblem(tx, doctor.id, startAt, endAt);
        if (problem) throw new BadRequestException(problem);

        const appt = await tx.appointment.create({
          data: {
            doctorId: doctor.id,
            patientId: patient.id,
            type: type || 'GENERAL',
            visitMode: visitMode ?? VisitMode.ONSITE,
            startAt,
            endAt,
          },
          include: transitionInclude,
        });
        await tx.appointmentStatusHistory.create({
          data: {
            appointmentId: appt.id,
            fromState: null,
            toState: 'PENDING',
            actorId: currentUserId,
            actorRole: 'PATIENT',
            note: 'Reservation requested',
          },
        });
        alerts = await this.notifyCreated(tx, appt);
        return appt;
      });
      this.notifications.publish(alerts);

      return {
        message: 'appointment created successfully',
        data: { id: created.id },
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Listings (unchanged contracts, plus the reservation reference)
  // ---------------------------------------------------------------------------

  async getForDoctor(
    currentUserId: string,
    query: GetAppointmentsQueryDto,
  ): Promise<PaginatedResponseDto<DoctorAppointmentDto>> {
    try {
      const doctor = await this.prisma.doctor.findUnique({
        where: { userId: currentUserId },
      });
      if (!doctor) throw new ForbiddenException('Only doctors can access this');

      const page = query.page || 1;
      const limit = query.limit || 10;
      const where: Prisma.AppointmentWhereInput = {
        doctorId: doctor.id,
        ...this.dateFilter(query),
      };

      const [totalCount, appointments] = await Promise.all([
        this.prisma.appointment.count({ where }),
        this.prisma.appointment.findMany({
          where,
          select: {
            id: true,
            refNo: true,
            startAt: true,
            endAt: true,
            state: true,
            type: true,
            visitMode: true,
            patient: { select: { user: { select: { name: true } } } },
          },
          orderBy: { startAt: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      return new PaginatedResponseDto(
        appointments.map((a) => ({
          id: a.id,
          reference: formatReservationRef(a.refNo),
          date: a.startAt.toISOString().slice(0, 10),
          time: a.startAt.toISOString().slice(11, 16),
          patient: a.patient.user.name,
          state: a.state,
          type: a.type,
          visitMode: a.visitMode,
        })),
        page,
        limit,
        totalCount,
      );
    } catch (error) {
      catchServiceError(error);
    }
  }

  async getByPatient(
    currentUserId: string,
    query: GetAppointmentsQueryDto,
  ): Promise<PaginatedResponseDto<PatientAppointmentDto>> {
    try {
      const patient = await this.prisma.patient.findUnique({
        where: { userId: currentUserId },
      });
      if (!patient)
        throw new ForbiddenException('Only patients can access this');

      const page = query.page || 1;
      const limit = query.limit || 10;
      const where: Prisma.AppointmentWhereInput = {
        patientId: patient.id,
        ...this.dateFilter(query),
      };

      const [totalCount, appointments] = await Promise.all([
        this.prisma.appointment.count({ where }),
        this.prisma.appointment.findMany({
          where,
          select: {
            id: true,
            refNo: true,
            startAt: true,
            endAt: true,
            state: true,
            type: true,
            visitMode: true,
            doctor: { select: { user: { select: { name: true } } } },
          },
          orderBy: { startAt: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      return new PaginatedResponseDto(
        appointments.map((a) => ({
          id: a.id,
          reference: formatReservationRef(a.refNo),
          date: a.startAt.toISOString().slice(0, 10),
          time: a.startAt.toISOString().slice(11, 16),
          doctor: a.doctor.user.name,
          status: a.state,
          type: a.type,
          visitMode: a.visitMode,
        })),
        page,
        limit,
        totalCount,
      );
    } catch (error) {
      catchServiceError(error);
    }
  }

  async getPerDayForDoctor(
    currentUserId: string,
    date: string,
  ): Promise<DoctorAppointmentDto[]> {
    try {
      if (!date) throw new BadRequestException('date is required');
      const doctor = await this.prisma.doctor.findUnique({
        where: { userId: currentUserId },
      });
      if (!doctor) throw new ForbiddenException('Only doctors can access this');

      const startOfDay = new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
      if (Number.isNaN(startOfDay.getTime()))
        throw new BadRequestException('Invalid date');
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);

      const appointments = await this.prisma.appointment.findMany({
        where: {
          doctorId: doctor.id,
          startAt: { gte: startOfDay, lte: endOfDay },
        },
        select: {
          id: true,
          refNo: true,
          startAt: true,
          endAt: true,
          type: true,
          state: true,
          visitMode: true,
          patient: { select: { user: { select: { name: true } } } },
        },
        orderBy: { startAt: 'asc' },
      });

      return appointments.map((a) => ({
        id: a.id,
        reference: formatReservationRef(a.refNo),
        date: a.startAt.toISOString().slice(0, 10),
        time: a.startAt.toISOString().slice(11, 16),
        patient: a.patient.user.name,
        state: a.state,
        type: a.type,
        visitMode: a.visitMode,
      }));
    } catch (error) {
      catchServiceError(error);
    }
  }

  async getById(
    id: string,
    currentUserId: string,
  ): Promise<AppointmentDetailDto> {
    try {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id },
        include: {
          doctor: {
            select: {
              id: true,
              userId: true,
              user: { select: { name: true } },
            },
          },
          patient: {
            select: {
              id: true,
              userId: true,
              user: { select: { name: true } },
            },
          },
        },
      });
      if (!appointment) throw new NotFoundException('Appointment not found');

      const isDoctor = appointment.doctor.userId === currentUserId;
      const isPatient = appointment.patient.userId === currentUserId;
      if (!isDoctor && !isPatient) {
        throw new ForbiddenException(
          "You don't have permission to view this appointment",
        );
      }
      const role: ActorRole = isDoctor ? 'DOCTOR' : 'PATIENT';

      return {
        id: appointment.id,
        reference: formatReservationRef(appointment.refNo),
        doctorId: appointment.doctorId,
        patientId: appointment.patientId,
        type: appointment.type,
        visitMode: appointment.visitMode,
        state: appointment.state,
        date: appointment.startAt.toISOString().slice(0, 10),
        time: appointment.startAt.toISOString().slice(11, 16),
        startAt: appointment.startAt,
        endAt: appointment.endAt,
        doctor: {
          id: appointment.doctor.id,
          userId: appointment.doctor.userId,
          name: appointment.doctor.user.name,
        },
        patient: {
          id: appointment.patient.id,
          userId: appointment.patient.userId,
          name: appointment.patient.user.name,
        },
        createdAt: appointment.createdAt,
        updatedAt: appointment.updatedAt,
        statusChangedAt: appointment.statusChangedAt,
        cancelReason: appointment.cancelReason,
        meetLink: appointment.meetLink,
        allowedActions: allowedTransitions(
          appointment.state,
          role,
          appointment.startAt,
          new Date(),
        ),
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  /**
   * Patients may change the label (`type`) or visit mode of their own PENDING request.
   * Date/time changes go through reschedule (doctor) so availability is re-checked.
   */
  async update(
    id: string,
    updateAppointmentDto: UpdateAppointmentDto,
    currentUserId: string,
  ): Promise<ResponseDto> {
    try {
      const { doctorUserId, date, time, durationMinutes, type, visitMode } =
        updateAppointmentDto;
      if (doctorUserId || date || time || durationMinutes) {
        throw new BadRequestException(
          'Doctor, date, time and duration cannot be edited. Cancel and book again, or ask the doctor to reschedule.',
        );
      }
      const existing = await this.prisma.appointment.findUnique({
        where: { id },
        include: { patient: { select: { userId: true } } },
      });
      if (!existing) throw new NotFoundException('Appointment not found');
      if (existing.patient.userId !== currentUserId) {
        throw new ForbiddenException(
          'Only the patient who booked can edit this request',
        );
      }
      if (existing.state !== 'PENDING') {
        throw new BadRequestException('Only pending requests can be edited');
      }
      const updated = await this.prisma.appointment.update({
        where: { id },
        data: {
          ...(type !== undefined ? { type } : {}),
          ...(visitMode !== undefined ? { visitMode } : {}),
        },
      });
      return {
        message: 'appointment updated successfully',
        data: { id: updated.id },
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle actions (all go through transition())
  // ---------------------------------------------------------------------------

  /** Patient or doctor cancels their own reservation. The row is kept (state CANCELLED). */
  async cancel(
    id: string,
    currentUserId: string,
    reason?: string,
  ): Promise<ResponseDto> {
    try {
      const appt = await this.load(id);
      const role: ActorRole | null =
        appt.patient.userId === currentUserId
          ? 'PATIENT'
          : appt.doctor.userId === currentUserId
            ? 'DOCTOR'
            : null;
      if (!role) {
        throw new ForbiddenException(
          "You don't have permission to cancel this appointment",
        );
      }
      await this.transition(
        appt,
        'cancel',
        { userId: currentUserId, role },
        reason,
      );
      return {
        message: 'Appointment cancelled successfully',
        data: { id: appt.id },
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async approveAppointment(
    appointmentId: string,
    doctorUserId: string,
    approveDto: ApproveAppointmentDto,
  ): Promise<AppointmentResponseDto> {
    try {
      const appt = await this.loadForDoctor(
        appointmentId,
        doctorUserId,
        'approve',
      );
      const now = new Date();
      assertTransition(
        'doctorConfirm',
        appt.state,
        'DOCTOR',
        appt.startAt,
        now,
      );

      // The slot may have been taken or closed since the request was made.
      const problem = await this.slotProblem(
        this.prisma,
        appt.doctorId,
        appt.startAt,
        appt.endAt,
        appt.id,
      );
      if (problem)
        throw new BadRequestException(
          `The requested time slot is no longer available: ${problem}`,
        );

      // External call outside the DB transaction; rolled back below if the DB update fails.
      let meet: { meetLink: string; eventId: string } | undefined;
      if (appt.visitMode === VisitMode.ONLINE) {
        meet = await this.createMeet(appt);
      }

      try {
        const updated = await this.transition(
          appt,
          'doctorConfirm',
          { userId: doctorUserId, role: 'DOCTOR' },
          approveDto.message,
          meet
            ? { meetLink: meet.meetLink, googleCalendarEventId: meet.eventId }
            : {},
        );
        return this.toResponse(updated);
      } catch (e) {
        if (meet) await this.googleCalendar.deleteEvent(meet.eventId);
        throw e;
      }
    } catch (error) {
      catchServiceError(error);
    }
  }

  async rejectAppointment(
    appointmentId: string,
    doctorUserId: string,
    rejectDto: RejectAppointmentDto,
  ): Promise<AppointmentResponseDto> {
    try {
      const appt = await this.loadForDoctor(
        appointmentId,
        doctorUserId,
        'reject',
      );
      const updated = await this.transition(
        appt,
        'reject',
        { userId: doctorUserId, role: 'DOCTOR' },
        rejectDto.reason,
      );
      return this.toResponse(updated);
    } catch (error) {
      catchServiceError(error);
    }
  }

  /** Doctor records the outcome after the visit time. */
  async recordOutcome(
    appointmentId: string,
    doctorUserId: string,
    outcome: 'complete' | 'noShow',
    note?: string,
  ): Promise<AppointmentResponseDto> {
    try {
      const appt = await this.loadForDoctor(
        appointmentId,
        doctorUserId,
        'update',
      );
      const updated = await this.transition(
        appt,
        outcome,
        { userId: doctorUserId, role: 'DOCTOR' },
        note,
      );
      return this.toResponse(updated);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async rescheduleAppointment(
    appointmentId: string,
    doctorUserId: string,
    rescheduleDto: RescheduleAppointmentDto,
  ): Promise<AppointmentResponseDto> {
    try {
      const appt = await this.loadForDoctor(
        appointmentId,
        doctorUserId,
        'reschedule',
      );
      if (!BLOCKING_STATES.includes(appt.state)) {
        throw new BadRequestException(
          `Cannot reschedule a reservation that is ${appt.state}`,
        );
      }

      const { newDate, newStart, newEnd, reason } = rescheduleDto;
      const newStartAt = atUtc(newDate, newStart, 'start time');
      const newEndAt = atUtc(newDate, newEnd, 'end time');
      if (newEndAt <= newStartAt)
        throw new BadRequestException('End time must be after start time');
      if (newStartAt < new Date())
        throw new BadRequestException('Cannot reschedule to a past date');

      let alerts: Notification[] = [];
      const updated = await this.prisma.$transaction(async (tx) => {
        await this.lockDoctor(tx, appt.doctorId);
        // Must fit the doctor's schedule (weekly hours, exceptions, leaves) and not overlap.
        const problem = await this.slotProblem(
          tx,
          appt.doctorId,
          newStartAt,
          newEndAt,
          appt.id,
        );
        if (problem)
          throw new BadRequestException(
            `The requested time slot is not available: ${problem}`,
          );

        const res = await tx.appointment.updateMany({
          where: { id: appt.id, state: appt.state },
          data: { startAt: newStartAt, endAt: newEndAt },
        });
        if (res.count === 0)
          throw new ConflictException(
            'Reservation changed meanwhile, reload and retry',
          );
        await tx.appointmentStatusHistory.create({
          data: {
            appointmentId: appt.id,
            fromState: appt.state,
            toState: appt.state,
            actorId: doctorUserId,
            actorRole: 'DOCTOR',
            note: `Rescheduled from ${appt.startAt.toISOString()} to ${newStartAt.toISOString()}${reason ? ` — ${reason}` : ''}`,
          },
        });
        alerts = await this.notifications.notifyUser(tx, appt.patient.userId, {
          type: NotificationType.RESERVATION_STATUS_CHANGED,
          content: `Your appointment with Dr ${appt.doctor.user.name} was moved to ${newStartAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
          entityType: 'Appointment',
          entityId: appt.id,
        });
        return tx.appointment.findUniqueOrThrow({
          where: { id: appt.id },
          include: transitionInclude,
        });
      });
      this.notifications.publish(alerts);
      await this.googleCalendar.moveEvent(
        updated.googleCalendarEventId,
        newStartAt,
        newEndAt,
      );
      return this.toResponse(updated);
    } catch (error) {
      catchServiceError(error);
    }
  }

  /**
   * The one place a reservation changes state. Checks the rule, updates conditionally
   * (so concurrent actions can't both win), writes history + audit (admins) + notifications
   * in one transaction, then pushes notifications and cleans up the calendar.
   */
  async transition(
    appt: AppointmentWithParties,
    name: TransitionName,
    actor: Pick<Actor, 'userId' | 'role'> & Partial<Actor>,
    note?: string | null,
    extraData: Prisma.AppointmentUpdateManyMutationInput = {},
  ): Promise<AppointmentWithParties> {
    const role = actor.role as ActorRole;
    const now = new Date();
    const to = assertTransition(
      name,
      appt.state,
      role,
      appt.startAt,
      now,
      note,
    );
    const cleanNote = note?.trim() || null;

    let alerts: Notification[] = [];
    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.appointment.updateMany({
        where: { id: appt.id, state: appt.state },
        data: {
          state: to,
          statusChangedAt: now,
          ...(to === 'CANCELLED'
            ? { cancelledById: actor.userId, cancelReason: cleanNote }
            : {}),
          ...extraData,
        },
      });
      if (res.count === 0) {
        throw new ConflictException(
          'Reservation status changed meanwhile, reload and retry',
        );
      }
      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId: appt.id,
          fromState: appt.state,
          toState: to,
          actorId: actor.userId,
          actorRole: role,
          note: cleanNote,
        },
      });
      if (role === 'ADMIN') {
        await this.audit.log(tx, {
          actor: actor as Actor,
          action: AuditAction.RESERVATION_STATUS_CHANGED,
          entityType: AuditEntity.APPOINTMENT,
          entityId: appt.id,
          before: { state: appt.state },
          after: { state: to, note: cleanNote },
          metadata: {
            reference: formatReservationRef(appt.refNo),
            transition: name,
          },
        });
      }
      alerts = await this.notifyTransition(tx, appt, to, role, cleanNote);
      return tx.appointment.findUniqueOrThrow({
        where: { id: appt.id },
        include: transitionInclude,
      });
    });

    this.notifications.publish(alerts);
    if (to === 'CANCELLED' || to === 'REJECTED') {
      await this.googleCalendar.deleteEvent(appt.googleCalendarEventId);
    }
    return updated;
  }

  async load(id: string): Promise<AppointmentWithParties> {
    const appt = await this.prisma.appointment.findUnique({
      where: { id },
      include: transitionInclude,
    });
    if (!appt) throw new NotFoundException('Appointment not found');
    return appt;
  }

  private async loadForDoctor(id: string, doctorUserId: string, verb: string) {
    const appt = await this.load(id);
    if (appt.doctor.userId !== doctorUserId) {
      throw new ForbiddenException(
        `You can only ${verb} your own appointments`,
      );
    }
    return appt;
  }

  // ---------------------------------------------------------------------------
  // Availability
  // ---------------------------------------------------------------------------

  /** Serialises bookings per doctor until the transaction ends. */
  private async lockDoctor(tx: Prisma.TransactionClient, doctorId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`appointment:${doctorId}`}))`;
  }

  /**
   * Why [startAt, endAt) can't be booked for this doctor, or null if it can.
   * Same rules as the slot list: leave > date exception > weekly hours, then overlaps.
   */
  async slotProblem(
    db: Prisma.TransactionClient | PrismaService,
    doctorId: string,
    startAt: Date,
    endAt: Date,
    excludeAppointmentId?: string,
  ): Promise<string | null> {
    if (
      utcDayStart(startAt).getTime() !==
      utcDayStart(new Date(endAt.getTime() - 1)).getTime()
    ) {
      return 'an appointment must start and end on the same day';
    }
    const day = utcDayStart(startAt);

    const leave = await db.doctorLeave.findFirst({
      where: { doctorId, startDate: { lte: day }, endDate: { gte: day } },
      select: { reason: true },
    });
    if (leave) return `the doctor is on leave (${leave.reason})`;

    let openMin: number;
    let closeMin: number;
    const exception = await db.scheduleException.findUnique({
      where: { doctorId_date: { doctorId, date: day } },
    });
    if (exception) {
      if (exception.type === 'CANCELLED')
        return 'the doctor is not available on this date';
      if (!exception.start || !exception.end)
        return 'the doctor has no hours set for this date';
      openMin = minutesOf(exception.start);
      closeMin = minutesOf(exception.end);
    } else {
      const workDay = await db.workDay.findFirst({
        where: { doctorId, day: WEEK_DAYS[startAt.getUTCDay()] },
      });
      if (!workDay) return 'the doctor does not work on this day';
      openMin = utcMinutes(workDay.startTime);
      closeMin = utcMinutes(workDay.endTime);
    }
    const startMin = utcMinutes(startAt);
    const endMin =
      startMin + Math.round((endAt.getTime() - startAt.getTime()) / 60_000);
    if (startMin < openMin || endMin > closeMin)
      return 'outside the doctor’s working hours';

    const overlap = await db.appointment.findFirst({
      where: {
        doctorId,
        state: { in: BLOCKING_STATES },
        ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true },
    });
    if (overlap) return 'the slot is already taken';
    return null;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Creates the Google Meet link for an online visit.
   * Without Google credentials: production refuses (patients would get no link), while
   * development approves without a link so the booking flow can be tested locally.
   */
  private async createMeet(
    appt: AppointmentWithParties,
  ): Promise<{ meetLink: string; eventId: string } | undefined> {
    if (!this.googleCalendar.isConfigured()) {
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(
          `Google Calendar is not configured: online appointment ${appt.id} approved without a Meet link (development only).`,
        );
        return undefined;
      }
      throw new BadRequestException(
        'Online appointments require Google credentials: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN.',
      );
    }
    const doctorEmail = appt.doctor.user.email;
    const patientEmail = appt.patient.user.email;
    if (!doctorEmail)
      throw new BadRequestException(
        'Doctor profile must have an email for online visits.',
      );
    if (!patientEmail)
      throw new BadRequestException(
        'Patient must have an email for online visits.',
      );
    try {
      return await this.googleCalendar.createEventWithMeetLink({
        summary: `Dermeee — ${appt.type}`,
        startAt: appt.startAt,
        endAt: appt.endAt,
        attendeeEmails: [patientEmail, doctorEmail],
      });
    } catch (err) {
      this.logger.error(
        `Google Calendar / Meet failed: ${err instanceof Error ? err.message : err}`,
      );
      throw new InternalServerErrorException(
        'Failed to create Google Meet link. Check Calendar API and credentials.',
      );
    }
  }

  private dateFilter(
    query: GetAppointmentsQueryDto,
  ): Prisma.AppointmentWhereInput {
    if (!query.dateFrom && !query.dateTo) return {};
    const startAt: Prisma.DateTimeFilter = {};
    if (query.dateFrom)
      startAt.gte = new Date(`${query.dateFrom.slice(0, 10)}T00:00:00.000Z`);
    if (query.dateTo)
      startAt.lte = new Date(`${query.dateTo.slice(0, 10)}T23:59:59.999Z`);
    return { startAt };
  }

  private toResponse(a: AppointmentWithParties): AppointmentResponseDto {
    return {
      id: a.id,
      reference: formatReservationRef(a.refNo),
      doctorId: a.doctorId,
      patientId: a.patientId,
      type: a.type,
      state: a.state,
      startAt: a.startAt,
      endAt: a.endAt,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      statusChangedAt: a.statusChangedAt,
      meetLink: a.meetLink,
    };
  }

  private async notifyCreated(
    tx: Prisma.TransactionClient,
    appt: AppointmentWithParties,
  ) {
    const when = appt.startAt.toISOString().slice(0, 16).replace('T', ' ');
    const ref = formatReservationRef(appt.refNo);
    const base = { entityType: 'Appointment', entityId: appt.id };
    return [
      ...(await this.notifications.notifyUser(tx, appt.doctor.userId, {
        ...base,
        type: NotificationType.RESERVATION_PENDING_DOCTOR,
        content: `New booking request ${ref} from ${appt.patient.user.name} for ${when} UTC.`,
        link: `/doctor/appointments/${appt.id}`,
      })),
      ...(await this.notifications.notifyAdmins(tx, {
        ...base,
        type: NotificationType.RESERVATION_PENDING_DOCTOR,
        content: `New reservation ${ref} awaiting confirmation by Dr ${appt.doctor.user.name} (${when} UTC).`,
        link: `/admin/reservations/${appt.id}`,
        dedupeKey: `reservation:${appt.id}:pending-doctor`,
      })),
    ];
  }

  /** Who hears about each state change. */
  private async notifyTransition(
    tx: Prisma.TransactionClient,
    appt: AppointmentWithParties,
    to: AppointmentState,
    by: ActorRole,
    note: string | null,
  ): Promise<Notification[]> {
    const ref = formatReservationRef(appt.refNo);
    const when = appt.startAt.toISOString().slice(0, 16).replace('T', ' ');
    const base = {
      type: NotificationType.RESERVATION_STATUS_CHANGED,
      entityType: 'Appointment',
      entityId: appt.id,
    };
    const out: Notification[] = [];
    const toPatient = async (content: string) =>
      out.push(
        ...(await this.notifications.notifyUser(tx, appt.patient.userId, {
          ...base,
          content,
        })),
      );
    const toDoctor = async (content: string) =>
      out.push(
        ...(await this.notifications.notifyUser(tx, appt.doctor.userId, {
          ...base,
          content,
        })),
      );

    switch (to) {
      case 'CONFIRMED':
        await toPatient(
          `Dr ${appt.doctor.user.name} confirmed your appointment ${ref} (${when} UTC).`,
        );
        out.push(
          ...(await this.notifications.notifyAdmins(tx, {
            ...base,
            type: NotificationType.RESERVATION_AWAITING_DERMEE,
            content: `Reservation ${ref} was confirmed by the doctor and awaits Dermee confirmation (${when} UTC).`,
            link: `/admin/reservations/${appt.id}`,
            dedupeKey: `reservation:${appt.id}:awaiting-dermee`,
          })),
        );
        break;
      case 'DERMEE_CONFIRMED':
        await toPatient(
          `Your appointment ${ref} (${when} UTC) is confirmed by Dermee.`,
        );
        await toDoctor(
          `Appointment ${ref} with ${appt.patient.user.name} is confirmed by Dermee.`,
        );
        break;
      case 'REJECTED':
        await toPatient(
          `Dr ${appt.doctor.user.name} could not accept your request ${ref}${note ? `: ${note}` : '.'}`,
        );
        break;
      case 'CANCELLED':
        if (by !== 'PATIENT')
          await toPatient(
            `Your appointment ${ref} was cancelled${note ? `: ${note}` : '.'}`,
          );
        if (by !== 'DOCTOR')
          await toDoctor(
            `Appointment ${ref} with ${appt.patient.user.name} was cancelled.`,
          );
        break;
      default:
        break;
    }
    return out;
  }
}
