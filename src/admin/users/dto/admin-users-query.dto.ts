import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { DateRangeQueryDto } from '../../../common/dto/list-query.dto';

export const ACCOUNT_STATUSES = [
  'ACTIVE',
  'PENDING',
  'SUSPENDED',
  'REJECTED',
] as const;
export type AccountStatusFilter = (typeof ACCOUNT_STATUSES)[number];

export const USER_SORTS = [
  'createdAt',
  'name',
  'role',
  'lastActivityAt',
] as const;

/**
 * Registration table filters. `from`/`to` filter the registration date.
 * `search` matches name, first/last name, phone and email.
 */
export class AdminUsersQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({
    enum: ['PATIENT', 'DOCTOR'],
    description: 'PATIENT = client',
  })
  @IsOptional()
  @IsIn(['PATIENT', 'DOCTOR'])
  role?: 'PATIENT' | 'DOCTOR';

  @ApiPropertyOptional({ enum: ACCOUNT_STATUSES })
  @IsOptional()
  @IsIn(ACCOUNT_STATUSES)
  status?: AccountStatusFilter;

  @ApiPropertyOptional({ description: 'Wilaya (contains, case-insensitive)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  wilaya?: string;

  @ApiPropertyOptional({ description: 'Commune (contains, case-insensitive)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  commune?: string;

  @ApiPropertyOptional({ enum: USER_SORTS, default: 'createdAt' })
  declare sortBy?: string;
}

export class ExportQueryDto extends AdminUsersQueryDto {
  @ApiPropertyOptional({ enum: ['csv', 'xlsx'], default: 'csv' })
  @IsOptional()
  @IsIn(['csv', 'xlsx'])
  format: 'csv' | 'xlsx' = 'csv';
}
