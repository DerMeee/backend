import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { DATE_ONLY } from '../../../common/dto/list-query.dto';
import type { Granularity } from '../timeseries';

export class TimeseriesQueryDto {
  @ApiPropertyOptional({ enum: ['day', 'week', 'month'], default: 'day' })
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  granularity: Granularity = 'day';

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'Default: 30 days before `to`',
  })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'Default: today (Algeria)',
  })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional({
    enum: ['PATIENT', 'DOCTOR'],
    description: 'Limit to one role',
  })
  @IsOptional()
  @IsIn(['PATIENT', 'DOCTOR'])
  role?: 'PATIENT' | 'DOCTOR';
}
