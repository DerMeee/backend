import { ApiProperty } from '@nestjs/swagger';
import { AppointmentState } from '@prisma/client';

export class AppointmentResponseDto {
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
    description: 'Appointment state',
    enum: AppointmentState,
    example: AppointmentState.CONFIRMED,
  })
  state: AppointmentState;

  @ApiProperty({
    description: 'Appointment start time',
    example: '2025-10-15T09:00:00.000Z',
  })
  startAt: Date;

  @ApiProperty({
    description: 'Appointment end time',
    example: '2025-10-15T10:00:00.000Z',
  })
  endAt: Date;

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
}
