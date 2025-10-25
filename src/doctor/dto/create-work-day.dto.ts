import { IsInt, IsNotEmpty, IsString, Matches, Max, Min } from 'class-validator';

export class CreateWorkDayDto {
  @IsNotEmpty()
  @IsInt()
  @Min(0)
  @Max(6)
  day: number; // 0 = Sunday, 6 = Saturday

  @IsNotEmpty()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'Start must be in HH:mm format' })
  start: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'End must be in HH:mm format' })
  end: string;
}
