import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RejectAppointmentDto {
  @ApiProperty({
    description: 'Reason for rejecting the appointment',
    example: 'Time slot is no longer available',
    minLength: 10,
    maxLength: 500,
  })
  @IsString()
  @MinLength(10, { message: 'Rejection reason must be at least 10 characters' })
  @MaxLength(500, { message: 'Rejection reason cannot exceed 500 characters' })
  reason: string;
}
