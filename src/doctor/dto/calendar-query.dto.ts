import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';

export class CalendarQueryDto {
  @ApiProperty({
    description: 'Month (1-12)',
    example: 10,
    minimum: 1,
    maximum: 12,
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @ApiProperty({
    description: 'Year (4 digits)',
    example: 2025,
    minimum: 2020,
    maximum: 2030,
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(2020)
  @Max(2030)
  year?: number;
}
