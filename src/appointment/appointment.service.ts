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
import { PrismaService } from '../prisma/prisma.service';
import { PaginatedResponseDto } from './dto/pagination-resp.dto';

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
}
