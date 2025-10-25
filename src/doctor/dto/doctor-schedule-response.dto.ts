import { ApiProperty } from '@nestjs/swagger';

export class DoctorScheduleResponseDto {
  @ApiProperty({
    description: 'Date for which schedule is requested',
    example: '2024-01-15',
  })
  date: string;

  @ApiProperty({
    description: 'Available time slots for the doctor on the given date',
    example: ['09:00', '09:30', '10:00', '10:30', '11:00'],
    type: [String],
  })
  slots: string[];

  @ApiProperty({
    description: 'Whether the doctor is available on this date',
    example: true,
  })
  available: boolean;

  @ApiProperty({
    description: 'Reason for unavailability (if applicable)',
    example: 'Doctor is not available on this date',
    required: false,
  })
  reason?: string;
}
