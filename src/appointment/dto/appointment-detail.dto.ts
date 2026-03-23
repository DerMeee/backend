import { ApiProperty } from '@nestjs/swagger';
import { AppointmentState, VisitMode } from '@prisma/client';

class DoctorInfoDto {
  @ApiProperty({ description: 'Doctor ID' })
  id: string;

  @ApiProperty({ description: 'Doctor name' })
  name: string;
}

class PatientInfoDto {
  @ApiProperty({ description: 'Patient ID' })
  id: string;

  @ApiProperty({ description: 'Patient name' })
  name: string;
}

export class AppointmentDetailDto {
  @ApiProperty({
    description: 'Appointment ID',
    example: 'cmgscuyjw0004uggovqk7ildx',
  })
  id: string;

  @ApiProperty({
    description: 'Doctor ID',
    example: 'cmgscuyjw0004uggovqk7ildx',
  })
  doctorId: string;

  @ApiProperty({
    description: 'Patient ID',
    example: 'cmgscuyjw0004uggovqk7ildx',
  })
  patientId: string;

  @ApiProperty({
    description: 'Appointment type',
    example: 'Consultation',
  })
  type: string;

  @ApiProperty({
    description: 'Online or onsite visit',
    enum: VisitMode,
    example: VisitMode.ONSITE,
  })
  visitMode: VisitMode;

  @ApiProperty({
    description: 'Appointment state',
    enum: AppointmentState,
    example: AppointmentState.CONFIRMED,
  })
  state: AppointmentState;

  @ApiProperty({
    description: 'Appointment date (YYYY-MM-DD)',
    example: '2025-10-15',
  })
  date: string;

  @ApiProperty({
    description: 'Appointment start time (HH:mm)',
    example: '09:00',
  })
  time: string;

  @ApiProperty({
    description: 'Appointment start time (ISO)',
    example: '2025-10-15T09:00:00.000Z',
  })
  startAt: Date;

  @ApiProperty({
    description: 'Appointment end time (ISO)',
    example: '2025-10-15T10:00:00.000Z',
  })
  endAt: Date;

  @ApiProperty({
    description: 'Doctor details',
    type: DoctorInfoDto,
  })
  doctor: DoctorInfoDto;

  @ApiProperty({
    description: 'Patient details',
    type: PatientInfoDto,
  })
  patient: PatientInfoDto;

  @ApiProperty({
    description: 'Appointment creation date',
    example: '2025-10-01T12:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Appointment last update date',
    example: '2025-10-01T12:30:00.000Z',
  })
  updatedAt: Date;

  @ApiProperty({
    description: 'Google Meet link when visit is online and approved',
    required: false,
    example: 'https://meet.google.com/xxx-yyyy-zzz',
  })
  meetLink?: string | null;
}
