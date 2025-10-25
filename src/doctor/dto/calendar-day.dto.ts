import { ApiProperty } from '@nestjs/swagger';

export class CalendarDayDto {
  @ApiProperty({
    description: 'Date in YYYY-MM-DD format',
    example: '2025-10-15',
  })
  date: string;

  @ApiProperty({
    description: 'Day of the week (0=Sunday, 6=Saturday)',
    example: 3,
  })
  dayOfWeek: number;

  @ApiProperty({
    description: 'Whether the doctor is available on this day',
    example: true,
  })
  available: boolean;

  @ApiProperty({
    description: 'Reason for unavailability (if not available)',
    example: 'Doctor is on leave: Annual vacation',
    required: false,
  })
  reason?: string;

  @ApiProperty({
    description: 'Available time slots for this day',
    example: ['09:00', '09:30', '10:00', '10:30'],
    type: [String],
  })
  slots: string[];

  @ApiProperty({
    description: 'Booked appointment slots',
    example: ['09:00', '10:30'],
    type: [String],
  })
  bookedSlots: string[];

  @ApiProperty({
    description: 'Work schedule for this day (if available)',
    example: { start: '09:00', end: '17:00' },
    required: false,
  })
  workSchedule?: {
    start: string;
    end: string;
  };

  @ApiProperty({
    description: 'Type of day',
    example: 'workday',
    enum: ['workday', 'holiday', 'exception', 'off'],
  })
  dayType: 'workday' | 'holiday' | 'exception' | 'off';
}
