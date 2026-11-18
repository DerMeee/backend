import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { DateRangeQueryDto } from '../../../common/dto/list-query.dto';

export const DOCTOR_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
] as const;
export const DOCTOR_SORTS = [
  'createdAt',
  'lastName',
  'firstName',
  'specialty',
  'reservations',
  'status',
] as const;

export class AdminDoctorsQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({
    enum: DOCTOR_STATUSES,
    description: 'SUSPENDED = account suspended',
  })
  @IsOptional()
  @IsIn(DOCTOR_STATUSES)
  status?: (typeof DOCTOR_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  specialty?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  wilaya?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  commune?: string;

  @ApiPropertyOptional({ enum: DOCTOR_SORTS, default: 'createdAt' })
  declare sortBy?: string;
}
