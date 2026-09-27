import { ApiProperty } from '@nestjs/swagger';

export class WorkDayResponseDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ description: 'Day of the week', example: 'MONDAY' })
  day: string;

  @ApiProperty({ description: 'Start time in HH:mm format', example: '09:00' })
  start: string;

  @ApiProperty({ description: 'End time in HH:mm format', example: '17:00' })
  end: string;
}

export class WorkDaysListResponseDto {
  @ApiProperty({ type: [WorkDayResponseDto] })
  data: WorkDayResponseDto[];
}
