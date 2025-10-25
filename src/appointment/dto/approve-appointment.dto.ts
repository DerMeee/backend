import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveAppointmentDto {
  @ApiProperty({
    description: 'Optional message from doctor when approving the appointment',
    example: 'Appointment approved. Please arrive 10 minutes early.',
    required: false,
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Message cannot exceed 500 characters' })
  message?: string;
}
