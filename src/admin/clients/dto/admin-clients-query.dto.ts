import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { DateRangeQueryDto } from '../../../common/dto/list-query.dto';

export const CLIENT_SORTS = [
  'createdAt',
  'lastName',
  'firstName',
  'reservations',
  'completedReservations',
  'cancelledReservations',
  'orders',
  'lastActivityAt',
] as const;

export class AdminClientsQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status?: 'ACTIVE' | 'SUSPENDED';

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

  @ApiPropertyOptional({ enum: CLIENT_SORTS, default: 'createdAt' })
  declare sortBy?: string;
}
