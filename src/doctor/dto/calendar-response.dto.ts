import { ApiProperty } from '@nestjs/swagger';
import { CalendarDayDto } from './calendar-day.dto';

export class CalendarResponseDto {
  @ApiProperty({
    description: 'Month being displayed',
    example: 10,
  })
  month: number;

  @ApiProperty({
    description: 'Year being displayed',
    example: 2025,
  })
  year: number;

  @ApiProperty({
    description: 'Total days in the month',
    example: 31,
  })
  totalDays: number;

  @ApiProperty({
    description: 'Number of available days',
    example: 22,
  })
  availableDays: number;

  @ApiProperty({
    description: 'Number of unavailable days',
    example: 9,
  })
  unavailableDays: number;

  @ApiProperty({
    description: 'Calendar days with availability information',
    type: [CalendarDayDto],
  })
  days: CalendarDayDto[];

  @ApiProperty({
    description: 'Summary statistics',
    example: {
      totalSlots: 440,
      bookedSlots: 45,
      availableSlots: 395,
      bookingRate: 10.2,
    },
  })
  summary: {
    totalSlots: number;
    bookedSlots: number;
    availableSlots: number;
    bookingRate: number;
  };
}
