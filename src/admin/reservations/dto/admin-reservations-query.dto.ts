import { ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentState } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { DATE_ONLY, ListQueryDto } from '../../../common/dto/list-query.dto';
import {
  URGENCY_LEVELS,
  type UrgencyLevel,
} from '../../../appointment/urgency';
import type { Granularity } from '../../stats/timeseries';

export const RESERVATION_SORTS = [
  'priority',
  'startAt',
  'createdAt',
  'statusChangedAt',
] as const;

const toArray = ({ value }: { value: unknown }) =>
  value === undefined || value === ''
    ? undefined
    : Array.isArray(value)
      ? value
      : String(value as string).split(',');

export class AdminReservationsQueryDto extends ListQueryDto {
  @ApiPropertyOptional({
    description: 'Reservation created on/after (YYYY-MM-DD)',
  })
  @IsOptional()
  @Matches(DATE_ONLY)
  createdFrom?: string;

  @ApiPropertyOptional({
    description: 'Reservation created on/before (YYYY-MM-DD)',
  })
  @IsOptional()
  @Matches(DATE_ONLY)
  createdTo?: string;

  @ApiPropertyOptional({ description: 'Appointment on/after (YYYY-MM-DD)' })
  @IsOptional()
  @Matches(DATE_ONLY)
  appointmentFrom?: string;

  @ApiPropertyOptional({ description: 'Appointment on/before (YYYY-MM-DD)' })
  @IsOptional()
  @Matches(DATE_ONLY)
  appointmentTo?: string;

  @ApiPropertyOptional({ description: 'Client name or phone' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  client?: string;

  @ApiPropertyOptional({ description: 'Doctor name or phone' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  doctor?: string;

  @ApiPropertyOptional({
    description: "Wilaya of the client's or the doctor's address",
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  wilaya?: string;

  @ApiPropertyOptional({
    description: "Commune of the client's or the doctor's address",
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  commune?: string;

  @ApiPropertyOptional({
    enum: AppointmentState,
    isArray: true,
    description: 'One or more, comma separated',
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(AppointmentState, { each: true })
  status?: AppointmentState[];

  @ApiPropertyOptional({ enum: URGENCY_LEVELS })
  @IsOptional()
  @IsIn(URGENCY_LEVELS)
  urgency?: UrgencyLevel;

  @ApiPropertyOptional({ enum: RESERVATION_SORTS, default: 'priority' })
  declare sortBy?: string;
}

export class ReservationTimeseriesQueryDto {
  @ApiPropertyOptional({ enum: ['day', 'week', 'month'], default: 'day' })
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  granularity: Granularity = 'day';

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(DATE_ONLY)
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Matches(DATE_ONLY)
  to?: string;

  @ApiPropertyOptional({
    enum: ['createdAt', 'startAt'],
    default: 'createdAt',
    description:
      'createdAt = bookings made; startAt = appointments taking place',
  })
  @IsOptional()
  @IsIn(['createdAt', 'startAt'])
  dateField: 'createdAt' | 'startAt' = 'createdAt';
}
