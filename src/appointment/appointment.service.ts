import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { GetAppointmentsQueryDto } from './dto/get-appointments-query.dto';
import { DoctorAppointmentDto } from './dto/doctor-appointment.dto';
import { PatientAppointmentDto } from './dto/patient-appointment.dto';
import { ApproveAppointmentDto } from './dto/approve-appointment.dto';
import { RejectAppointmentDto } from './dto/reject-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { AppointmentResponseDto } from './dto/appointment-response.dto';
import { PrismaService } from '../prisma/prisma.service';
import { PaginatedResponseDto } from './dto/pagination-resp.dto';
import { AppointmentState, WeekDay } from '@prisma/client';

@Injectable()
export class AppointmentService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    createAppointmentDto: CreateAppointmentDto,
    currentUserId: string,
  ) {
    try {
      const { doctorUserId, date, time, durationMinutes, type } =
        createAppointmentDto;
      if (!doctorUserId || !date || !time) {
        throw new BadRequestException(
          'doctorUserId, date and time are required',
        );
      }

      // Combine date and time, ensure not in the past
      const [hoursStr, minutesStr] = time.split(':');
      const hours = Number(hoursStr);
      const minutes = Number(minutesStr);
      if (Number.isNaN(hours) || Number.isNaN(minutes)) {
        throw new BadRequestException('Invalid time format, expected HH:mm');
      }

      const startAt = new Date(date);
      startAt.setHours(hours, minutes, 0, 0);
      if (startAt < new Date()) {
        throw new BadRequestException('Cannot book past dates');
      }

      // Resolve patient and doctor domain ids (Patient.id, Doctor.id) from User.id
      const [patient, doctor] = await Promise.all([
        this.prisma.patient.findUnique({ where: { userId: currentUserId } }),
        this.prisma.doctor.findUnique({ where: { userId: doctorUserId } }),
      ]);

      if (!patient)
        throw new ForbiddenException('Only a patient can create appointments');
      if (!doctor) throw new BadRequestException('Doctor not found');

      // Check conflict: same doctor, overlapping slot. Old logic only matched exact date+time, we emulate exact same start time conflict
      const conflict = await this.prisma.appointment.findFirst({
        where: {
          doctorId: doctor.id,
          startAt,
          // consider scheduled or confirmed as conflicting
          state: { in: ['SCHEDULED', 'CONFIRMED'] },
        },
      });
      if (conflict) {
        throw new BadRequestException('Appointment already taken');
      }

      const endAt = new Date(startAt);
      if (durationMinutes && durationMinutes > 0) {
        endAt.setMinutes(endAt.getMinutes() + durationMinutes);
      } else {
        // default 30 minutes if not provided
        endAt.setMinutes(endAt.getMinutes() + 30);
      }

      const created = await this.prisma.appointment.create({
        data: {
          doctorId: doctor.id,
          patientId: patient.id,
          type: type || 'GENERAL',
          startAt,
          endAt,
          // default state SCHEDULED per schema
        },
      });
      return {
        status: 200,
        message: 'appointment created successfully',
        data: {
          id: created.id,
        },
      };
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException(error);
    }
  }

  async getForDoctor(
    currentUserId: string,
    query: GetAppointmentsQueryDto,
  ): Promise<PaginatedResponseDto<DoctorAppointmentDto>> {
    const doctor = await this.prisma.doctor.findUnique({
      where: { userId: currentUserId },
    });
    if (!doctor) throw new ForbiddenException('Only doctors can access this');

    // Extract pagination parameters
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    // Build date filter
    const dateFilter: any = {};
    if (query.dateFrom || query.dateTo) {
      dateFilter.startAt = {};

      if (query.dateFrom) {
        const fromDate = new Date(query.dateFrom);
        fromDate.setHours(0, 0, 0, 0);
        dateFilter.startAt.gte = fromDate;
      }

      if (query.dateTo) {
        const toDate = new Date(query.dateTo);
        toDate.setHours(23, 59, 59, 999);
        dateFilter.startAt.lte = toDate;
      }
    }

    // Get total count for pagination metadata
    const totalCount = await this.prisma.appointment.count({
      where: {
        doctorId: doctor.id,
        ...dateFilter,
      },
    });

    // Get paginated appointments
    const appointments = await this.prisma.appointment.findMany({
      where: {
        doctorId: doctor.id,
        ...dateFilter,
      },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        state: true,
        type: true,
        patient: { select: { user: { select: { name: true } } } },
      },
      orderBy: { startAt: 'asc' },
      skip,
      take: limit,
    });

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return {
      data: appointments.map((a) => ({
        id: a.id,
        date: a.startAt.toISOString().slice(0, 10),
        time: a.startAt.toISOString().slice(11, 16),
        patient: a.patient.user.name,
        state: a.state,
        type: a.type,
      })),
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages,
        hasNext: hasNextPage,
        hasPrev: hasPrevPage,
      },
    };
  }

  async getByPatient(
    currentUserId: string,
    query: GetAppointmentsQueryDto,
  ): Promise<PaginatedResponseDto<PatientAppointmentDto>> {
    const patient = await this.prisma.patient.findUnique({
      where: { userId: currentUserId },
    });
    if (!patient) throw new ForbiddenException('Only patients can access this');

    // Extract pagination parameters
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    // Build date filter
    const dateFilter: any = {};
    if (query.dateFrom || query.dateTo) {
      dateFilter.startAt = {};

      if (query.dateFrom) {
        const fromDate = new Date(query.dateFrom);
        fromDate.setHours(0, 0, 0, 0);
        dateFilter.startAt.gte = fromDate;
      }

      if (query.dateTo) {
        const toDate = new Date(query.dateTo);
        toDate.setHours(23, 59, 59, 999);
        dateFilter.startAt.lte = toDate;
      }
    }

    // Get total count for pagination metadata
    const totalCount = await this.prisma.appointment.count({
      where: {
        patientId: patient.id,
        ...dateFilter,
      },
    });

    // Get paginated appointments
    const appointments = await this.prisma.appointment.findMany({
      where: {
        patientId: patient.id,
        ...dateFilter,
      },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        state: true,
        type: true,
        doctor: { select: { user: { select: { name: true } } } },
      },
      orderBy: { startAt: 'asc' },
      skip,
      take: limit,
    });

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return {
      data: appointments.map((a) => ({
        id: a.id,
        date: a.startAt.toISOString().slice(0, 10),
        time: a.startAt.toISOString().slice(11, 16),
        doctor: a.doctor.user.name,
        status: a.state,
        type: a.type,
      })),
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages,
        hasNext: hasNextPage,
        hasPrev: hasPrevPage,
      },
    };
  }

  async getPerDayForDoctor(currentUserId: string, date: string): Promise<DoctorAppointmentDto[]> {
    if (!date) throw new BadRequestException('date is required');
    const doctor = await this.prisma.doctor.findUnique({
      where: { userId: currentUserId },
    });
    if (!doctor) throw new ForbiddenException('Only doctors can access this');

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        doctorId: doctor.id,
        startAt: { gte: startOfDay, lte: endOfDay },
      },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        type: true,
        state: true,
        patient: { select: { user: { select: { name: true } } } },
      },
      orderBy: { startAt: 'asc' },
    });

    return appointments.map((a) => ({
      id: a.id,
      date: a.startAt.toISOString().slice(0, 10),
      time: a.startAt.toISOString().slice(11, 16),
      patient: a.patient.user.name,
      state: a.state,
      type: a.type,
    }));
  }

  async update(id: string, updateAppointmentDto: UpdateAppointmentDto) {
    const existing = await this.prisma.appointment.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Appointment not found');

    const updated = await this.prisma.appointment.update({
      where: { id },
      data: updateAppointmentDto as any,
    });
    return updated;
  }

  async cancel(id: string, currentUserId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      select: {
        id: true,
        doctor: { select: { userId: true } },
        patient: { select: { userId: true } },
      },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');

    const allowed =
      appointment.patient.userId === currentUserId ||
      appointment.doctor.userId === currentUserId;
    if (!allowed)
      throw new ForbiddenException(
        "You don't have permission to cancel this appointment",
      );

    await this.prisma.appointment.delete({ where: { id } });
    return { success: true, message: 'Appointment cancelled successfully' };
  }

  async approveAppointment(
    appointmentId: string,
    doctorUserId: string,
    approveDto: ApproveAppointmentDto,
  ): Promise<AppointmentResponseDto> {
    try {
      // First, verify the doctor exists and get their ID
      const doctor = await this.prisma.doctor.findUnique({
        where: { userId: doctorUserId },
        select: { id: true },
      });

      if (!doctor) {
        throw new NotFoundException('Doctor not found');
      }

      // Get the appointment and verify it belongs to this doctor
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          doctor: true,
          patient: {
            include: {
              user: true,
            },
          },
        },
      });

      if (!appointment) {
        throw new NotFoundException('Appointment not found');
      }

      if (appointment.doctorId !== doctor.id) {
        throw new ForbiddenException('You can only approve your own appointments');
      }

      if (appointment.state !== AppointmentState.PENDING) {
        throw new BadRequestException(
          `Cannot approve appointment in ${appointment.state} state`,
        );
      }

      // Check if the requested time is still available
      const isTimeAvailable = await this.isTimeSlotAvailable(
        appointment.doctorId,
        appointment.startAt,
        appointment.endAt,
        appointmentId, // Exclude current appointment from conflict check
      );

      if (!isTimeAvailable) {
        throw new BadRequestException(
          'The requested time slot is no longer available',
        );
      }

      // Update the appointment state to CONFIRMED
      const updatedAppointment = await this.prisma.appointment.update({
        where: { id: appointmentId },
        data: {
          state: AppointmentState.CONFIRMED,
        },
        include: {
          doctor: true,
          patient: {
            include: {
              user: true,
            },
          },
        },
      });

      // TODO: Send notification to patient about approval
      // This could be implemented with a notification service
      if (approveDto.message) {
        // Store the approval message or send notification
        console.log(`Approval message for appointment ${appointmentId}: ${approveDto.message}`);
      }

      return {
        id: updatedAppointment.id,
        doctorId: updatedAppointment.doctorId,
        patientId: updatedAppointment.patientId,
        type: updatedAppointment.type,
        state: updatedAppointment.state,
        startAt: updatedAppointment.startAt,
        endAt: updatedAppointment.endAt,
        createdAt: updatedAppointment.createdAt,
        updatedAt: updatedAppointment.updatedAt,
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to approve appointment',
      );
    }
  }

  async rejectAppointment(
    appointmentId: string,
    doctorUserId: string,
    rejectDto: RejectAppointmentDto,
  ): Promise<AppointmentResponseDto> {
    try {
      // First, verify the doctor exists and get their ID
      const doctor = await this.prisma.doctor.findUnique({
        where: { userId: doctorUserId },
        select: { id: true },
      });

      if (!doctor) {
        throw new NotFoundException('Doctor not found');
      }

      // Get the appointment and verify it belongs to this doctor
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          doctor: true,
          patient: {
            include: {
              user: true,
            },
          },
        },
      });

      if (!appointment) {
        throw new NotFoundException('Appointment not found');
      }

      if (appointment.doctorId !== doctor.id) {
        throw new ForbiddenException('You can only reject your own appointments');
      }

      if (appointment.state !== AppointmentState.PENDING) {
        throw new BadRequestException(
          `Cannot reject appointment in ${appointment.state} state`,
        );
      }

      // Update the appointment state to CANCELLED
      const updatedAppointment = await this.prisma.appointment.update({
        where: { id: appointmentId },
        data: {
          state: AppointmentState.CANCELLED,
        },
        include: {
          doctor: true,
          patient: {
            include: {
              user: true,
            },
          },
        },
      });

      // TODO: Send notification to patient about rejection with reason
      // This could be implemented with a notification service
      console.log(`Rejection reason for appointment ${appointmentId}: ${rejectDto.reason}`);

      return {
        id: updatedAppointment.id,
        doctorId: updatedAppointment.doctorId,
        patientId: updatedAppointment.patientId,
        type: updatedAppointment.type,
        state: updatedAppointment.state,
        startAt: updatedAppointment.startAt,
        endAt: updatedAppointment.endAt,
        createdAt: updatedAppointment.createdAt,
        updatedAt: updatedAppointment.updatedAt,
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to reject appointment',
      );
    }
  }

  private async isTimeSlotAvailable(
    doctorId: string,
    startAt: Date,
    endAt: Date,
    excludeAppointmentId?: string,
  ): Promise<boolean> {
    try {
      // Check for conflicting appointments
      const conflictingAppointment = await this.prisma.appointment.findFirst({
        where: {
          doctorId,
          id: excludeAppointmentId ? { not: excludeAppointmentId } : undefined,
          state: {
            in: [AppointmentState.SCHEDULED, AppointmentState.CONFIRMED],
          },
          OR: [
            // New appointment starts during existing appointment
            {
              AND: [
                { startAt: { lte: startAt } },
                { endAt: { gt: startAt } },
              ],
            },
            // New appointment ends during existing appointment
            {
              AND: [
                { startAt: { lt: endAt } },
                { endAt: { gte: endAt } },
              ],
            },
            // New appointment completely contains existing appointment
            {
              AND: [
                { startAt: { gte: startAt } },
                { endAt: { lte: endAt } },
              ],
            },
          ],
        },
      });

      if (conflictingAppointment) {
        return false;
      }

      // Check if the time falls within doctor's work hours
      const workDay = await this.prisma.workDay.findFirst({
        where: {
          doctorId,
          day: this.getDayOfWeek(startAt) as WeekDay,
        },
      });

      if (!workDay) {
        return false; // Doctor doesn't work on this day
      }

      const appointmentStartTime = this.getTimeFromDate(startAt);
      const appointmentEndTime = this.getTimeFromDate(endAt);
      const workStartTime = this.getTimeFromDate(workDay.startTime);
      const workEndTime = this.getTimeFromDate(workDay.endTime);

      // Check if appointment is within work hours
      if (appointmentStartTime < workStartTime || appointmentEndTime > workEndTime) {
        return false;
      }

      // Check for schedule exceptions (holidays, leaves, etc.)
      const scheduleException = await this.prisma.scheduleException.findFirst({
        where: {
          doctorId,
          date: {
            gte: new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate()),
            lt: new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate() + 1),
          },
        },
      });

      if (scheduleException) {
        return false; // Time falls within a schedule exception
      }

      // Check for doctor leaves
      const doctorLeave = await this.prisma.doctorLeave.findFirst({
        where: {
          doctorId,
          startDate: { lte: startAt },
          endDate: { gte: endAt },
        },
      });

      if (doctorLeave) {
        return false; // Doctor is on leave during this time
      }

      return true;
    } catch (error) {
      console.error('Error checking time slot availability:', error);
      return false;
    }
  }

  private getDayOfWeek(date: Date): string {
    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    return days[date.getDay()];
  }

  private getTimeFromDate(date: Date): number {
    return date.getHours() * 100 + date.getMinutes();
  }

  async rescheduleAppointment(
    appointmentId: string,
    doctorUserId: string,
    rescheduleDto: RescheduleAppointmentDto,
  ): Promise<AppointmentResponseDto> {
    try {
      // First, verify the doctor exists and get their ID
      const doctor = await this.prisma.doctor.findUnique({
        where: { userId: doctorUserId },
        select: { id: true },
      });

      if (!doctor) {
        throw new NotFoundException('Doctor not found');
      }

      // Get the appointment and verify it belongs to this doctor
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          doctor: true,
          patient: {
            include: {
              user: true,
            },
          },
        },
      });

      if (!appointment) {
        throw new NotFoundException('Appointment not found');
      }

      if (appointment.doctorId !== doctor.id) {
        throw new ForbiddenException('You can only reschedule your own appointments');
      }

      if (appointment.state === AppointmentState.CANCELLED) {
        throw new BadRequestException('Cannot reschedule a cancelled appointment');
      }

      // Parse and validate the new date and times
      const { newDate, newStart, newEnd, reason } = rescheduleDto;
      
      // Parse new start time
      const [startHoursStr, startMinutesStr] = newStart.split(':');
      const startHours = Number(startHoursStr);
      const startMinutes = Number(startMinutesStr);
      
      if (Number.isNaN(startHours) || Number.isNaN(startMinutes)) {
        throw new BadRequestException('Invalid start time format, expected HH:mm');
      }

      // Parse new end time
      const [endHoursStr, endMinutesStr] = newEnd.split(':');
      const endHours = Number(endHoursStr);
      const endMinutes = Number(endMinutesStr);
      
      if (Number.isNaN(endHours) || Number.isNaN(endMinutes)) {
        throw new BadRequestException('Invalid end time format, expected HH:mm');
      }

      // Create new start and end dates
      const newStartAt = new Date(newDate);
      newStartAt.setHours(startHours, startMinutes, 0, 0);
      
      const newEndAt = new Date(newDate);
      newEndAt.setHours(endHours, endMinutes, 0, 0);

      // Validate that end time is after start time
      if (newEndAt <= newStartAt) {
        throw new BadRequestException('End time must be after start time');
      }

      // Validate that the new date is not in the past
      if (newStartAt < new Date()) {
        throw new BadRequestException('Cannot reschedule to a past date');
      }

      // Check if the new time slot is available
      const isTimeAvailable = await this.isTimeSlotAvailable(
        appointment.doctorId,
        newStartAt,
        newEndAt,
        appointmentId, // Exclude current appointment from conflict check
      );

      if (!isTimeAvailable) {
        throw new BadRequestException(
          'The requested time slot is no longer available',
        );
      }

      // Check if the new time falls within standard working hours
      const isWithinStandardHours = await this.isWithinStandardWorkingHours(
        appointment.doctorId,
        newStartAt,
        newEndAt,
      );

      // If not within standard hours, create a schedule exception
      if (!isWithinStandardHours) {
        await this.createScheduleException(
          appointment.doctorId,
          newStartAt,
          newEndAt,
          reason || 'Appointment rescheduled outside standard hours',
        );
      }

      // Update the appointment with new times
      const updatedAppointment = await this.prisma.appointment.update({
        where: { id: appointmentId },
        data: {
          startAt: newStartAt,
          endAt: newEndAt,
          // If appointment was pending, keep it pending; if confirmed, keep confirmed
          state: appointment.state === AppointmentState.PENDING 
            ? AppointmentState.PENDING 
            : AppointmentState.CONFIRMED,
        },
        include: {
          doctor: true,
          patient: {
            include: {
              user: true,
            },
          },
        },
      });

      // TODO: Send notification to patient about rescheduling
      console.log(`Appointment ${appointmentId} rescheduled to ${newStartAt.toISOString()}`);

      return {
        id: updatedAppointment.id,
        doctorId: updatedAppointment.doctorId,
        patientId: updatedAppointment.patientId,
        type: updatedAppointment.type,
        state: updatedAppointment.state,
        startAt: updatedAppointment.startAt,
        endAt: updatedAppointment.endAt,
        createdAt: updatedAppointment.createdAt,
        updatedAt: updatedAppointment.updatedAt,
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to reschedule appointment',
      );
    }
  }

  private async isWithinStandardWorkingHours(
    doctorId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<boolean> {
    try {
      // Get the doctor's work day for the new date
      const workDay = await this.prisma.workDay.findFirst({
        where: {
          doctorId,
          day: this.getDayOfWeek(startAt) as WeekDay,
        },
      });

      if (!workDay) {
        return false; // Doctor doesn't work on this day
      }

      const appointmentStartTime = this.getTimeFromDate(startAt);
      const appointmentEndTime = this.getTimeFromDate(endAt);
      const workStartTime = this.getTimeFromDate(workDay.startTime);
      const workEndTime = this.getTimeFromDate(workDay.endTime);

      // Check if appointment is within work hours
      return appointmentStartTime >= workStartTime && appointmentEndTime <= workEndTime;
    } catch (error) {
      console.error('Error checking standard working hours:', error);
      return false;
    }
  }

  private async createScheduleException(
    doctorId: string,
    startAt: Date,
    endAt: Date,
    reason: string,
  ): Promise<void> {
    try {
      await this.prisma.scheduleException.create({
        data: {
          doctorId,
          date: new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate()),
          type: 'ADDED', // Using ADDED for rescheduled appointments outside standard hours
          start: `${startAt.getHours().toString().padStart(2, '0')}:${startAt.getMinutes().toString().padStart(2, '0')}`,
          end: `${endAt.getHours().toString().padStart(2, '0')}:${endAt.getMinutes().toString().padStart(2, '0')}`,
          reason,
        },
      });
    } catch (error) {
      console.error('Error creating schedule exception:', error);
      // Don't throw error here as the appointment rescheduling should still succeed
    }
  }
}
