import { Prisma } from '@prisma/client';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { GetDoctorsQueryDto } from './dto/get-doctors-query.dto';
import { DoctorResponseDto } from './dto/doctor-response.dto';
import { PaginatedResponseDto } from '../appointment/dto/pagination-resp.dto';
import { publicDoctorUserWhere } from './doctor-visibility';
import { BLOCKING_STATES } from '../appointment/appointment-state';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  compareAsc,
  parse,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  format,
  getDay,
  addDays,
} from 'date-fns';
import { CreateWorkDaysBulkDto } from './dto/create-work-days-bulk.dto';
import {
  WorkDayResponseDto,
  WorkDaysListResponseDto,
} from './dto/work-day-response.dto';
import { CreateExceptionDto } from './dto/create-exception.dto';
import { CreateDoctorLeaveDto } from './dto/create-doctor-leave.dto';
import { DoctorLeaveResponseDto } from './dto/doctor-leave-response.dto';
import { CalendarQueryDto } from './dto/calendar-query.dto';
import { CalendarResponseDto } from './dto/calendar-response.dto';
import { CalendarDayDto } from './dto/calendar-day.dto';
import { ExportQueryDto, ExportFormat } from './dto/export-query.dto';
import { ResponseDto } from './dto/response.dto';
import { GetSchedualExcepDto } from './dto/get-schedual-excep.dto';
import { catchServiceError } from '../utils/catch-service-error';

/**
 * Work hours, slots and appointment times are exchanged in UTC ("HH:mm"), whatever the
 * server time zone. Saved hours use the "HH:mm" digits as UTC (setUTCHours).
 */
function hhmmUtc(d: Date): string {
  return d.toISOString().slice(11, 16);
}

/** Fields of a doctor that patients may see (no phone, no internal status). */
const publicDoctorSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  profilePictureUrl: true,
  createdAt: true,
  updatedAt: true,
  address: { select: { state: true, city: true, street: true } },
  doctorProfile: {
    select: { specialty: true, fees: true, workYears: true, about: true },
  },
} satisfies Prisma.UserSelect;

function toPublicDoctor(
  d: Prisma.UserGetPayload<{ select: typeof publicDoctorSelect }>,
): DoctorResponseDto {
  return {
    id: d.id,
    name: d.name,
    email: d.email,
    role: d.role,
    specialty: d.doctorProfile?.specialty ?? null,
    fees: d.doctorProfile?.fees,
    workYears: d.doctorProfile?.workYears,
    about: d.doctorProfile?.about ?? null,
    profilePictureUrl: d.profilePictureUrl,
    wilaya: d.address?.state ?? null,
    commune: d.address?.city ?? null,
    street: d.address?.street ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

@Injectable()
export class DoctorService {
  constructor(private readonly prisma: PrismaService) {}
  create(_createDoctorDto: CreateDoctorDto) {
    return 'This action adds a new doctor';
  }

  /** Public doctor directory: approved, active doctors only. */
  async findAll(
    query: GetDoctorsQueryDto,
  ): Promise<PaginatedResponseDto<DoctorResponseDto>> {
    try {
      const page = query.page || 1;
      const limit = query.limit || 10;
      const and: Prisma.UserWhereInput[] = [publicDoctorUserWhere];
      if (query.search?.trim()) {
        const contains = {
          contains: query.search.trim(),
          mode: 'insensitive' as const,
        };
        and.push({
          OR: [
            { name: contains },
            { doctorProfile: { is: { specialty: contains } } },
          ],
        });
      }
      if (query.specialty?.trim()) {
        and.push({
          doctorProfile: {
            is: {
              specialty: {
                contains: query.specialty.trim(),
                mode: 'insensitive',
              },
            },
          },
        });
      }
      if (query.wilaya?.trim()) {
        and.push({
          address: {
            is: {
              state: { contains: query.wilaya.trim(), mode: 'insensitive' },
            },
          },
        });
      }
      const where: Prisma.UserWhereInput = { AND: and };

      const [totalCount, doctors] = await Promise.all([
        this.prisma.user.count({ where }),
        this.prisma.user.findMany({
          where,
          select: publicDoctorSelect,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);
      return new PaginatedResponseDto(
        doctors.map(toPublicDoctor),
        page,
        limit,
        totalCount,
      );
    } catch (error) {
      catchServiceError(error);
    }
  }

  async findOne(id: string): Promise<DoctorResponseDto> {
    try {
      const doctor = await this.prisma.user.findFirst({
        where: { id, ...publicDoctorUserWhere },
        select: publicDoctorSelect,
      });
      if (!doctor) {
        throw new NotFoundException("Doctor doesn't exist");
      }
      return toPublicDoctor(doctor);
    } catch (error) {
      catchServiceError(error);
    }
  }

  /** Closes one weekday (0 = Sunday … 6 = Saturday) in the doctor's weekly schedule. */
  async removeWorkDay(doctorUserId: string, day: number) {
    try {
      const weekDays = [
        'SUNDAY',
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY',
      ] as const;
      const weekDay = weekDays[day];
      if (!weekDay)
        throw new BadRequestException(
          'day must be between 0 (Sunday) and 6 (Saturday)',
        );
      const doctor = await this.prisma.doctor.findUnique({
        where: { userId: doctorUserId },
        select: { id: true },
      });
      if (!doctor) throw new NotFoundException('Doctor profile not found');
      const res = await this.prisma.workDay.deleteMany({
        where: { doctorId: doctor.id, day: weekDay },
      });
      if (res.count === 0)
        throw new NotFoundException('This day is not in your schedule');
      return { message: 'Work day removed', data: { day: weekDay } };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async getWorkDays(doctorId: string): Promise<WorkDaysListResponseDto> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: doctorId, role: 'DOCTOR' },
        include: {
          doctorProfile: {
            include: { workDays: true },
          },
        },
      });

      if (!user || !user.doctorProfile) {
        throw new NotFoundException(
          'Doctor profile not found or user is not a doctor',
        );
      }

      const dayOrder = [
        'SUNDAY',
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY',
      ];

      const data: WorkDayResponseDto[] = user.doctorProfile.workDays
        .sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day))
        .map((wd) => ({
          id: wd.id,
          day: wd.day,
          start: hhmmUtc(new Date(wd.startTime)),
          end: hhmmUtc(new Date(wd.endTime)),
        }));

      return { data };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async createWorkDays(
    doctorId: string,
    dto: CreateWorkDaysBulkDto,
  ): Promise<ResponseDto> {
    try {
      const weekDays = [
        'SUNDAY',
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY',
      ];

      const user = await this.prisma.user.findUnique({
        where: { id: doctorId, role: 'DOCTOR' },
        include: { doctorProfile: true },
      });

      if (!user || !user.doctorProfile) {
        throw new NotFoundException(
          'Doctor profile not found or user is not a doctor',
        );
      }

      // Reject duplicate days within the request
      const requestedDayNumbers = dto.days.map((d) => d.day);
      if (new Set(requestedDayNumbers).size !== requestedDayNumbers.length) {
        throw new BadRequestException('Duplicate days in request');
      }

      // Validate time order for each entry
      for (const item of dto.days) {
        const startTime = parse(item.start, 'HH:mm', new Date());
        const endTime = parse(item.end, 'HH:mm', new Date());
        if (compareAsc(endTime, startTime) <= 0) {
          throw new BadRequestException(
            `End time must be after start time for ${weekDays[item.day]}`,
          );
        }
      }

      // Check for already-configured days
      const requestedWeekDays = dto.days.map((d) => weekDays[d.day] as any);
      const alreadySet = await this.prisma.workDay.findMany({
        where: {
          doctorId: user.doctorProfile.id,
          day: { in: requestedWeekDays },
        },
      });
      if (alreadySet.length > 0) {
        const names = alreadySet.map((d) => d.day).join(', ');
        throw new BadRequestException(
          `These days are already configured: ${names}`,
        );
      }

      // Build DateTime objects and create all in a transaction
      const doctorProfileId = user.doctorProfile.id;
      const today = new Date();
      const created = await this.prisma.$transaction(
        dto.days.map((item) => {
          const weekDay = weekDays[item.day] as any;
          const startTime = parse(item.start, 'HH:mm', new Date());
          const endTime = parse(item.end, 'HH:mm', new Date());

          const startDateTime = new Date(today);
          startDateTime.setUTCHours(
            startTime.getHours(),
            startTime.getMinutes(),
            0,
            0,
          );
          const endDateTime = new Date(today);
          endDateTime.setUTCHours(
            endTime.getHours(),
            endTime.getMinutes(),
            0,
            0,
          );

          return this.prisma.workDay.create({
            data: {
              doctorId: doctorProfileId,
              day: weekDay,
              startTime: startDateTime,
              endTime: endDateTime,
            },
          });
        }),
      );

      return {
        message: 'Work days created successfully',
        data: { id: created.map((wd) => wd.id).join(',') },
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  /**
   * Free slots for one day. `publicOnly` (patient-facing booking) refuses doctors that
   * are not approved or are suspended; doctors reading their own schedule pass false.
   */
  async getDoctorSchedule(
    doctorId: string,
    date: string,
    publicOnly = false,
  ): Promise<{
    date: string;
    slots: string[];
    available: boolean;
    reason?: string;
  }> {
    try {
      // Find the doctor with their work days
      const doctor = await this.prisma.user.findFirst({
        where: {
          id: doctorId,
          ...(publicOnly ? publicDoctorUserWhere : { role: 'DOCTOR' }),
        },
        include: {
          doctorProfile: {
            include: {
              workDays: true,
            },
          },
        },
      });

      if (!doctor || !doctor.doctorProfile) {
        throw new NotFoundException('Doctor Not Found');
      }

      // Parse the date and create date objects for the start and end of the day
      const dateObj = new Date(date + 'T00:00:00.000Z'); // Ensure UTC timezone
      const dayOfWeek = dateObj.getUTCDay();

      // Convert to our WeekDay enum format (0 = Sunday, 6 = Saturday)
      const weekDayMap: Record<
        number,
        | 'SUNDAY'
        | 'MONDAY'
        | 'TUESDAY'
        | 'WEDNESDAY'
        | 'THURSDAY'
        | 'FRIDAY'
        | 'SATURDAY'
      > = {
        0: 'SUNDAY',
        1: 'MONDAY',
        2: 'TUESDAY',
        3: 'WEDNESDAY',
        4: 'THURSDAY',
        5: 'FRIDAY',
        6: 'SATURDAY',
      };

      const dayName = weekDayMap[dayOfWeek];

      // Validate that we have a valid day name
      if (!dayName) {
        throw new BadRequestException('Invalid day of week');
      }

      // Check for holidays first
      const holiday = await this.prisma.doctorLeave.findFirst({
        where: {
          doctorId: doctor.doctorProfile.id,
          startDate: { lte: dateObj },
          endDate: { gte: dateObj },
        },
      });

      if (holiday) {
        return {
          date,
          slots: [],
          available: false,
          reason: `Doctor is on leave: ${holiday.reason}`,
        };
      }

      // Check for schedule exceptions
      const exception = await this.prisma.scheduleException.findUnique({
        where: {
          doctorId_date: {
            doctorId: doctor.doctorProfile.id,
            date: dateObj,
          },
        },
      });

      let startTime: Date;
      let endTime: Date;
      let reason: string | undefined;

      if (exception) {
        switch (exception.type) {
          case 'CANCELLED':
            return {
              date,
              slots: [],
              available: false,
              reason:
                exception.reason || 'Doctor is not available on this date',
            };
          case 'CHANGED':
          case 'ADDED':
            if (!exception.start || !exception.end) {
              throw new BadRequestException(
                'Exception start and end times are required for CHANGED/ADDED types',
              );
            }
            // Parse the time strings (format: "HH:MM")
            const [startHour, startMinute] = exception.start
              .split(':')
              .map(Number);
            const [endHour, endMinute] = exception.end.split(':').map(Number);

            startTime = new Date(dateObj);
            startTime.setUTCHours(startHour, startMinute, 0, 0);

            endTime = new Date(dateObj);
            endTime.setUTCHours(endHour, endMinute, 0, 0);

            reason = exception.reason || undefined;
            break;
          default:
            throw new BadRequestException('Invalid exception type');
        }
      } else {
        // Find working day for this day of week
        const workingDay = doctor.doctorProfile.workDays.find(
          (workDay) => workDay.day === dayName,
        );

        if (!workingDay) {
          return {
            date,
            slots: [],
            available: false,
            reason: 'Doctor does not work on this day of the week',
          };
        }

        // Parse the work day times
        startTime = new Date(workingDay.startTime);
        endTime = new Date(workingDay.endTime);
      }

      // Generate time slots (30-minute intervals)
      const slotDuration = 30; // minutes
      const slots: string[] = [];
      const current = new Date(startTime);
      const end = new Date(endTime);

      while (current < end) {
        const timeString = hhmmUtc(current);
        slots.push(timeString);
        current.setUTCMinutes(current.getUTCMinutes() + slotDuration);
      }

      // Get existing appointments for this date to filter out booked slots
      const startOfDay = new Date(dateObj);
      startOfDay.setUTCHours(0, 0, 0, 0);

      const endOfDay = new Date(dateObj);
      endOfDay.setUTCHours(23, 59, 59, 999);

      const appointments = await this.prisma.appointment.findMany({
        where: {
          doctorId: doctor.doctorProfile.id,
          startAt: {
            gte: startOfDay,
            lte: endOfDay,
          },
          // Only reservations that occupy the slot (not cancelled/rejected/no-show/completed).
          state: { in: BLOCKING_STATES },
        },
      });

      // Extract booked times and filter them out
      const bookedTimes = appointments.map((appointment) => {
        const appointmentTime = new Date(appointment.startAt);
        return hhmmUtc(appointmentTime);
      });

      const availableSlots = slots.filter(
        (slot) => !bookedTimes.includes(slot),
      );

      return {
        date,
        slots: availableSlots,
        available: availableSlots.length > 0,
        reason:
          reason ||
          (availableSlots.length === 0 ? 'No available time slots' : undefined),
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async updateWorkDays(
    doctorId: string,
    dto: CreateWorkDaysBulkDto,
  ): Promise<ResponseDto> {
    try {
      const weekDays = [
        'SUNDAY',
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY',
      ];

      const user = await this.prisma.user.findUnique({
        where: { id: doctorId, role: 'DOCTOR' },
        include: { doctorProfile: true },
      });

      if (!user || !user.doctorProfile) {
        throw new NotFoundException(
          'Doctor profile not found or user is not a doctor',
        );
      }

      // Reject duplicate days within the request
      const requestedDayNumbers = dto.days.map((d) => d.day);
      if (new Set(requestedDayNumbers).size !== requestedDayNumbers.length) {
        throw new BadRequestException('Duplicate days in request');
      }

      // Validate time order and existence for each entry upfront
      for (const item of dto.days) {
        const startTime = parse(item.start, 'HH:mm', new Date());
        const endTime = parse(item.end, 'HH:mm', new Date());
        if (compareAsc(endTime, startTime) <= 0) {
          throw new BadRequestException(
            `End time must be after start time for ${weekDays[item.day]}`,
          );
        }

        const existing = await this.prisma.workDay.findUnique({
          where: {
            doctorId_day: {
              doctorId: user.doctorProfile.id,
              day: weekDays[item.day] as any,
            },
          },
        });
        if (!existing) {
          throw new NotFoundException(
            `Work day not configured for ${weekDays[item.day]}`,
          );
        }
      }

      // Update all in a transaction
      const doctorProfileId = user.doctorProfile.id;
      const today = new Date();
      const updated = await this.prisma.$transaction(
        dto.days.map((item) => {
          const weekDay = weekDays[item.day] as any;
          const startTime = parse(item.start, 'HH:mm', new Date());
          const endTime = parse(item.end, 'HH:mm', new Date());

          const startDateTime = new Date(today);
          startDateTime.setUTCHours(
            startTime.getHours(),
            startTime.getMinutes(),
            0,
            0,
          );
          const endDateTime = new Date(today);
          endDateTime.setUTCHours(
            endTime.getHours(),
            endTime.getMinutes(),
            0,
            0,
          );

          return this.prisma.workDay.update({
            where: {
              doctorId_day: {
                doctorId: doctorProfileId,
                day: weekDay,
              },
            },
            data: { startTime: startDateTime, endTime: endDateTime },
          });
        }),
      );

      return {
        message: 'Work days updated successfully',
        data: { id: updated.map((wd) => wd.id).join(',') },
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async createExceptionDate(
    doctorId: string,
    dto: CreateExceptionDto,
  ): Promise<ResponseDto> {
    try {
      // Resolve user -> doctor profile id (foreign key in ScheduleException)
      const user = await this.prisma.user.findUnique({
        where: { id: doctorId, role: 'DOCTOR' },
        include: { doctorProfile: true },
      });
      if (!user || !user.doctorProfile) {
        throw new NotFoundException(
          'Doctor profile not found or user is not a doctor',
        );
      }

      const doctorProfileId = user.doctorProfile.id;

      const { date, type, start, end, reason } = dto;

      // Validate combinations
      if (type === 'CANCELLED' && (start || end)) {
        throw new BadRequestException(
          'Cancelled exceptions cannot include time ranges',
        );
      }
      if ((type === 'ADDED' || type === 'CHANGED') && (!start || !end)) {
        throw new BadRequestException('Start and end time are required');
      }

      // Normalize date to UTC midnight to align with unique index and lookups
      const d = new Date(date);
      const normalized = new Date(
        Date.UTC(
          d.getUTCFullYear(),
          d.getUTCMonth(),
          d.getUTCDate(),
          0,
          0,
          0,
          0,
        ),
      );

      // Save exception
      const schedule = await this.prisma.scheduleException.create({
        data: {
          doctorId: doctorProfileId,
          date: normalized,
          type,
          start: start ?? null,
          end: end ?? null,
          reason: reason ?? null,
        },
      });
      return {
        message: 'Schedule exception created successfully',
        data: {
          id: schedule.id,
        },
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async deleteExceptionDate(
    doctorId: string,
    exceptionId: string,
  ): Promise<ResponseDto> {
    try {
      const doctor = await this.prisma.user.findUnique({
        where: { id: doctorId },
        include: {
          doctorProfile: true,
        },
      });

      if (!doctor || !doctor?.doctorProfile) {
        throw new NotFoundException('Doctor Not found');
      }

      const exception = await this.prisma.scheduleException.findUnique({
        where: { id: exceptionId },
      });
      if (!exception) {
        throw new NotFoundException('Exception not found');
      }
      if (exception.doctorId !== doctor.doctorProfile.id) {
        throw new ForbiddenException(
          'You cannot delete exceptions of another doctor',
        );
      }

      const schedule = await this.prisma.scheduleException.delete({
        where: { id: exceptionId },
      });
      return {
        message: 'Schedule exception deleted successfully',
        data: { id: schedule.id },
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async getAllExceptions(
    userId: string,
    query: GetDoctorsQueryDto,
  ): Promise<PaginatedResponseDto<GetSchedualExcepDto>> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId, role: 'DOCTOR' },
        include: { doctorProfile: true },
      });

      if (!user || !user.doctorProfile) {
        throw new NotFoundException(
          'Doctor profile not found or user is not a doctor',
        );
      }

      const page = query.page || 1;
      const limit = query.limit || 10;
      const skip = (page - 1) * limit;

      const totalCount = await this.prisma.scheduleException.count({
        where: { doctorId: user.doctorProfile.id },
      });

      const schedule = await this.prisma.scheduleException.findMany({
        where: { doctorId: user.doctorProfile.id },
        orderBy: { date: 'desc' },
        skip: skip,
        take: limit,
      });

      const totalPages = Math.ceil(totalCount / limit);
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;
      return {
        data: schedule.map((exception) => ({
          id: exception.id,
          doctorId: exception.doctorId,
          date: exception.date,
          type: exception.type,
          start: exception.start || '',
          end: exception.end || '',
          reason: exception.reason || '',
          createdAt: exception.createdAt,
          updatedAt: exception.updatedAt,
        })),
        pagination: {
          page: page,
          limit: limit,
          total: totalCount,
          totalPages: totalPages,
          hasNext: hasNextPage,
          hasPrev: hasPrevPage,
        },
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async createDoctorLeave(
    doctorId: string,
    dto: CreateDoctorLeaveDto,
  ): Promise<DoctorLeaveResponseDto> {
    try {
      // Verify doctor exists
      const user = await this.prisma.user.findUnique({
        where: { id: doctorId, role: 'DOCTOR' },
        include: { doctorProfile: true },
      });

      if (!user || !user.doctorProfile) {
        throw new NotFoundException(
          'Doctor profile not found or user is not a doctor',
        );
      }

      const { startDate, endDate, reason } = dto;

      // Validate date range
      const start = new Date(startDate);
      const end = new Date(endDate);

      // A one-day leave has the same start and end date.
      if (start > end) {
        throw new BadRequestException('End date must not be before start date');
      }

      // Check for overlapping leaves
      const overlappingLeave = await this.prisma.doctorLeave.findFirst({
        where: {
          doctorId: user.doctorProfile.id,
          OR: [
            {
              AND: [{ startDate: { lte: start } }, { endDate: { gte: start } }],
            },
            {
              AND: [{ startDate: { lte: end } }, { endDate: { gte: end } }],
            },
            {
              AND: [{ startDate: { gte: start } }, { endDate: { lte: end } }],
            },
          ],
        },
      });

      if (overlappingLeave) {
        throw new BadRequestException(
          'A leave period already exists that overlaps with the requested dates',
        );
      }

      // Create the leave record
      const leave = await this.prisma.doctorLeave.create({
        data: {
          doctorId: user.doctorProfile.id,
          startDate: start,
          endDate: end,
          reason,
        },
      });

      return {
        id: leave.id,
        doctorId: leave.doctorId,
        startDate: leave.startDate,
        endDate: leave.endDate,
        reason: leave.reason,
        createdAt: leave.createdAt,
        updatedAt: leave.updatedAt,
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async deleteDoctorLeave(
    doctorId: string,
    leaveId: string,
  ): Promise<ResponseDto> {
    try {
      // Verify doctor exists
      const user = await this.prisma.user.findUnique({
        where: { id: doctorId, role: 'DOCTOR' },
        include: { doctorProfile: true },
      });

      if (!user || !user.doctorProfile) {
        throw new NotFoundException(
          'Doctor profile not found or user is not a doctor',
        );
      }

      // Find the leave record
      const leave = await this.prisma.doctorLeave.findUnique({
        where: { id: leaveId },
      });

      if (!leave) {
        throw new NotFoundException('Leave record not found');
      }

      // Verify the leave belongs to the doctor
      if (leave.doctorId !== user.doctorProfile.id) {
        throw new ForbiddenException(
          'You cannot delete leave records of another doctor',
        );
      }

      // Delete the leave record
      const schedual = await this.prisma.doctorLeave.delete({
        where: { id: leaveId },
      });

      return {
        message: 'Leave record deleted successfully',
        data: { id: schedual.id },
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async getAllDoctorLeaves(
    doctorId: string,
    query: GetDoctorsQueryDto,
  ): Promise<PaginatedResponseDto<DoctorLeaveResponseDto>> {
    try {
      // Verify doctor exists
      const user = await this.prisma.user.findUnique({
        where: { id: doctorId, role: 'DOCTOR' },
        include: { doctorProfile: true },
      });

      if (!user || !user.doctorProfile) {
        throw new NotFoundException(
          'Doctor profile not found or user is not a doctor',
        );
      }

      const page = query.page || 1;
      const limit = query.limit || 10;
      const skip = (page - 1) * limit;

      const totalCount = await this.prisma.doctorLeave.count({
        where: { doctorId: user.doctorProfile.id },
      });

      // Get all leave records for the doctor (paginated)
      const leaves = await this.prisma.doctorLeave.findMany({
        where: { doctorId: user.doctorProfile.id },
        orderBy: { startDate: 'desc' },
        skip,
        take: limit,
      });

      const totalPages = Math.ceil(totalCount / limit);
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;

      return {
        data: leaves.map((leave) => ({
          id: leave.id,
          doctorId: leave.doctorId,
          startDate: leave.startDate,
          endDate: leave.endDate,
          reason: leave.reason,
          createdAt: leave.createdAt,
          updatedAt: leave.updatedAt,
        })),
        pagination: {
          page: page,
          limit: limit,
          total: totalCount,
          totalPages: totalPages,
          hasNext: hasNextPage,
          hasPrev: hasPrevPage,
        },
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async getDoctorCalendar(
    doctorId: string,
    query: CalendarQueryDto,
  ): Promise<CalendarResponseDto> {
    try {
      // Verify doctor exists
      const user = await this.prisma.user.findUnique({
        where: { id: doctorId, role: 'DOCTOR' },
        include: {
          doctorProfile: {
            include: {
              workDays: true,
              scheduleExceptions: true,
              leaves: true,
              appointments: {
                where: {
                  state: { in: BLOCKING_STATES },
                },
                select: {
                  startAt: true,
                  endAt: true,
                },
              },
            },
          },
        },
      });

      if (!user || !user.doctorProfile) {
        throw new NotFoundException(
          'Doctor profile not found or user is not a doctor',
        );
      }

      // Use current month/year if not provided
      const now = new Date();
      const month = query.month || now.getMonth() + 1;
      const year = query.year || now.getFullYear();

      // Create date range for the month
      const monthStart = startOfMonth(new Date(year, month - 1, 1));
      const monthEnd = endOfMonth(new Date(year, month - 1, 1));
      const daysInMonth = eachDayOfInterval({
        start: monthStart,
        end: monthEnd,
      });

      const calendarDays: CalendarDayDto[] = [];
      let availableDays = 0;
      let unavailableDays = 0;
      let totalSlots = 0;
      let bookedSlots = 0;

      // Process each day of the month
      for (const day of daysInMonth) {
        const dateStr = format(day, 'yyyy-MM-dd');
        const dayOfWeek = getDay(day);
        const dayResult = await this.getDayAvailability(
          user.doctorProfile,
          dateStr,
          dayOfWeek,
        );

        calendarDays.push(dayResult);

        // dayResult.slots lists the FREE slots only, so capacity = free + booked, counted on every
        // open day (fully booked days included).
        const open =
          dayResult.dayType === 'workday' ||
          (dayResult.dayType === 'exception' && !!dayResult.workSchedule);
        if (open) {
          totalSlots += dayResult.slots.length + dayResult.bookedSlots.length;
          bookedSlots += dayResult.bookedSlots.length;
        }
        if (dayResult.available) {
          availableDays++;
        } else {
          unavailableDays++;
        }
      }

      const availableSlots = totalSlots - bookedSlots;
      const bookingRate = totalSlots > 0 ? (bookedSlots / totalSlots) * 100 : 0;

      return {
        month,
        year,
        totalDays: daysInMonth.length,
        availableDays,
        unavailableDays,
        days: calendarDays,
        summary: {
          totalSlots,
          bookedSlots,
          availableSlots,
          bookingRate: Math.round(bookingRate * 100) / 100,
        },
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  private async getDayAvailability(
    doctorProfile: any,
    date: string,
    dayOfWeek: number,
  ): Promise<CalendarDayDto> {
    const dateObj = new Date(date + 'T00:00:00.000Z');
    const weekDayMap: Record<number, string> = {
      0: 'SUNDAY',
      1: 'MONDAY',
      2: 'TUESDAY',
      3: 'WEDNESDAY',
      4: 'THURSDAY',
      5: 'FRIDAY',
      6: 'SATURDAY',
    };

    const dayName = weekDayMap[dayOfWeek];

    // Check for holidays first
    const holiday = doctorProfile.leaves.find((leave: any) => {
      const start = new Date(leave.startDate);
      const end = new Date(leave.endDate);
      return dateObj >= start && dateObj <= end;
    });

    if (holiday) {
      return {
        date,
        dayOfWeek,
        available: false,
        reason: `Doctor is on leave: ${holiday.reason}`,
        slots: [],
        bookedSlots: [],
        dayType: 'holiday',
      };
    }

    // Check for schedule exceptions
    const exception = doctorProfile.scheduleExceptions.find((exc: any) => {
      const excDate = new Date(exc.date);
      return excDate.toDateString() === dateObj.toDateString();
    });

    if (exception) {
      let slots: string[] = [];
      let workSchedule: { start: string; end: string } | undefined;

      if (exception.type === 'CANCELLED') {
        return {
          date,
          dayOfWeek,
          available: false,
          reason: exception.reason || 'Doctor is not available on this date',
          slots: [],
          bookedSlots: [],
          dayType: 'exception',
        };
      } else if (exception.type === 'ADDED' || exception.type === 'CHANGED') {
        if (exception.start && exception.end) {
          slots = this.generateTimeSlots(exception.start, exception.end);
          workSchedule = { start: exception.start, end: exception.end };
        }
      }

      const bookedSlots = this.getBookedSlotsForDay(
        doctorProfile.appointments,
        dateObj,
      );
      const availableSlots = slots.filter(
        (slot) => !bookedSlots.includes(slot),
      );

      return {
        date,
        dayOfWeek,
        available: availableSlots.length > 0,
        reason: exception.reason || undefined,
        slots: availableSlots,
        bookedSlots,
        workSchedule,
        dayType: 'exception',
      };
    }

    // Check regular work schedule
    const workDay = doctorProfile.workDays.find(
      (wd: any) => wd.day === dayName,
    );

    if (!workDay) {
      return {
        date,
        dayOfWeek,
        available: false,
        reason: 'Doctor does not work on this day of the week',
        slots: [],
        bookedSlots: [],
        dayType: 'off',
      };
    }

    // Generate slots for regular work day
    const startTime = new Date(workDay.startTime);
    const endTime = new Date(workDay.endTime);
    const startStr = hhmmUtc(startTime);
    const endStr = hhmmUtc(endTime);
    const slots = this.generateTimeSlots(startStr, endStr);

    const bookedSlots = this.getBookedSlotsForDay(
      doctorProfile.appointments,
      dateObj,
    );
    const availableSlots = slots.filter((slot) => !bookedSlots.includes(slot));

    return {
      date,
      dayOfWeek,
      available: availableSlots.length > 0,
      reason:
        availableSlots.length === 0 ? 'No available time slots' : undefined,
      slots: availableSlots,
      bookedSlots,
      workSchedule: { start: startStr, end: endStr },
      dayType: 'workday',
    };
  }

  private generateTimeSlots(startTime: string, endTime: string): string[] {
    const slots: string[] = [];
    const start = parse(startTime, 'HH:mm', new Date());
    const end = parse(endTime, 'HH:mm', new Date());
    const current = new Date(start);

    while (current < end) {
      slots.push(format(current, 'HH:mm'));
      current.setMinutes(current.getMinutes() + 30);
    }

    return slots;
  }

  private getBookedSlotsForDay(appointments: any[], date: Date): string[] {
    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setUTCHours(23, 59, 59, 999);

    return appointments
      .filter((apt) => {
        const aptDate = new Date(apt.startAt);
        return aptDate >= startOfDay && aptDate <= endOfDay;
      })
      .map((apt) => {
        const aptTime = new Date(apt.startAt);
        return hhmmUtc(aptTime);
      });
  }

  async exportDoctorSchedule(
    doctorId: string,
    query: ExportQueryDto,
  ): Promise<{ data: string; contentType: string; filename: string }> {
    try {
      // Verify doctor exists
      const user = await this.prisma.user.findUnique({
        where: { id: doctorId, role: 'DOCTOR' },
        include: {
          doctorProfile: {
            include: {
              workDays: true,
              scheduleExceptions: true,
              leaves: true,
              appointments: {
                where: {
                  state: { in: BLOCKING_STATES },
                },
                include: {
                  patient: {
                    include: {
                      user: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!user || !user.doctorProfile) {
        throw new NotFoundException(
          'Doctor profile not found or user is not a doctor',
        );
      }

      const format = query.format || ExportFormat.ICS;
      const startDate = query.startDate
        ? new Date(query.startDate)
        : new Date();
      const endDate = query.endDate
        ? new Date(query.endDate)
        : addDays(startDate, 30);

      if (format === ExportFormat.ICS) {
        return this.generateICS(user.doctorProfile, startDate, endDate);
      } else {
        return this.generateJSON(user.doctorProfile, startDate, endDate);
      }
    } catch (error) {
      catchServiceError(error);
    }
  }

  private generateICS(
    doctorProfile: any,
    startDate: Date,
    endDate: Date,
  ): { data: string; contentType: string; filename: string } {
    const doctorName = doctorProfile.user?.name || 'Doctor';
    const icsContent = this.buildICSContent(
      doctorProfile,
      startDate,
      endDate,
      doctorName,
    );

    return {
      data: icsContent,
      contentType: 'text/calendar; charset=utf-8',
      filename: `doctor-schedule-${format(startDate, 'yyyy-MM-dd')}-to-${format(endDate, 'yyyy-MM-dd')}.ics`,
    };
  }

  private generateJSON(
    doctorProfile: any,
    startDate: Date,
    endDate: Date,
  ): { data: string; contentType: string; filename: string } {
    const scheduleData = {
      doctor: {
        name: doctorProfile.user?.name || 'Doctor',
        id: doctorProfile.id,
      },
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      workDays: doctorProfile.workDays,
      exceptions: doctorProfile.scheduleExceptions,
      leaves: doctorProfile.leaves,
      appointments: doctorProfile.appointments,
    };

    return {
      data: JSON.stringify(scheduleData, null, 2),
      contentType: 'application/json',
      filename: `doctor-schedule-${format(startDate, 'yyyy-MM-dd')}-to-${format(endDate, 'yyyy-MM-dd')}.json`,
    };
  }

  private buildICSContent(
    doctorProfile: any,
    startDate: Date,
    endDate: Date,
    doctorName: string,
  ): string {
    const now = new Date();
    const icsId = `doctor-schedule-${doctorProfile.id}`;

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//DerMee//Doctor Schedule//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];

    // Add work days as recurring events
    for (const workDay of doctorProfile.workDays) {
      const dayMap: Record<string, number> = {
        SUNDAY: 0,
        MONDAY: 1,
        TUESDAY: 2,
        WEDNESDAY: 3,
        THURSDAY: 4,
        FRIDAY: 5,
        SATURDAY: 6,
      };

      const dayOfWeek = dayMap[workDay.day];
      if (dayOfWeek !== undefined) {
        const startTime = format(new Date(workDay.startTime), 'HHmmss');
        const endTime = format(new Date(workDay.endTime), 'HHmmss');

        ics.push(
          'BEGIN:VEVENT',
          `UID:${icsId}-workday-${workDay.day}`,
          `DTSTART:${format(startDate, 'yyyyMMdd')}T${startTime}`,
          `DTEND:${format(startDate, 'yyyyMMdd')}T${endTime}`,
          `RRULE:FREQ=WEEKLY;BYDAY=${workDay.day.substring(0, 2)};UNTIL=${format(endDate, 'yyyyMMdd')}T235959`,
          `SUMMARY:${doctorName} - Work Day (${workDay.day})`,
          `DESCRIPTION:Regular work schedule for ${workDay.day}`,
          `DTSTAMP:${format(now, 'yyyyMMdd')}T${format(now, 'HHmmss')}`,
          'END:VEVENT',
        );
      }
    }

    // Add holidays
    for (const leave of doctorProfile.leaves) {
      const leaveStart = new Date(leave.startDate);
      const leaveEnd = new Date(leave.endDate);

      if (leaveStart >= startDate && leaveStart <= endDate) {
        ics.push(
          'BEGIN:VEVENT',
          `UID:${icsId}-leave-${leave.id}`,
          `DTSTART:${format(leaveStart, 'yyyyMMdd')}`,
          `DTEND:${format(addDays(leaveEnd, 1), 'yyyyMMdd')}`,
          `SUMMARY:${doctorName} - Leave: ${leave.reason}`,
          `DESCRIPTION:Doctor is on leave: ${leave.reason}`,
          `DTSTAMP:${format(now, 'yyyyMMdd')}T${format(now, 'HHmmss')}`,
          'STATUS:CONFIRMED',
          'END:VEVENT',
        );
      }
    }

    // Add appointments
    for (const appointment of doctorProfile.appointments) {
      const aptStart = new Date(appointment.startAt);
      const aptEnd = new Date(appointment.endAt);

      if (aptStart >= startDate && aptStart <= endDate) {
        ics.push(
          'BEGIN:VEVENT',
          `UID:${icsId}-appointment-${appointment.id}`,
          `DTSTART:${format(aptStart, 'yyyyMMdd')}T${format(aptStart, 'HHmmss')}`,
          `DTEND:${format(aptEnd, 'yyyyMMdd')}T${format(aptEnd, 'HHmmss')}`,
          `SUMMARY:Appointment with ${appointment.patient.user.name}`,
          `DESCRIPTION:Appointment: ${appointment.type}`,
          `DTSTAMP:${format(now, 'yyyyMMdd')}T${format(now, 'HHmmss')}`,
          'STATUS:CONFIRMED',
          'END:VEVENT',
        );
      }
    }

    ics.push('END:VCALENDAR');

    return ics.join('\r\n');
  }

  remove(id: number) {
    return `This action removes a #${id} doctor`;
  }
}
