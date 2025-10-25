import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class RescheduleAppointmentDto {
  @ApiProperty({
    description: 'New date for the appointment (YYYY-MM-DD)',
    example: '2025-10-20',
  })
  @IsNotEmpty({ message: 'New date is required' })
  @IsDateString({}, { message: 'New date must be a valid date string (YYYY-MM-DD)' })
  newDate: string;

  @ApiProperty({
    description: 'New start time for the appointment (HH:mm)',
    example: '14:30',
  })
  @IsNotEmpty({ message: 'New start time is required' })
  @IsString({ message: 'New start time must be a string' })
  newStart: string;

  @ApiProperty({
    description: 'New end time for the appointment (HH:mm)',
    example: '15:30',
  })
  @IsNotEmpty({ message: 'New end time is required' })
  @IsString({ message: 'New end time must be a string' })
  newEnd: string;

  @ApiProperty({
    description: 'Optional reason for rescheduling',
    example: 'Patient requested different time slot',
    required: false,
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Reason cannot exceed 500 characters' })
  reason?: string;
}
