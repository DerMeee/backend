import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Matches, Max, Min } from 'class-validator';

export class CreateWorkDayDto {
  @IsNotEmpty()
  @IsInt()
  @Min(0)
  @Max(6)
  @ApiProperty({ description: 'Day of the week (0 = Sunday, 6 = Saturday)', type: Number })
  day: number; // 0 = Sunday, 6 = Saturday

  @IsNotEmpty()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'Start must be in HH:mm format' })
  @ApiProperty({ description: 'Start time in HH:mm format', type: String })
  start: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'End must be in HH:mm format' })
  @ApiProperty({ description: 'End time in HH:mm format', type: String })
  end: string;
}
