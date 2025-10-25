import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export enum ExportFormat {
  ICS = 'ics',
  JSON = 'json',
}

export class ExportQueryDto {
  @ApiProperty({
    description: 'Export format',
    example: 'ics',
    enum: ExportFormat,
    required: false,
    default: ExportFormat.ICS,
  })
  @IsOptional()
  @IsEnum(ExportFormat)
  format?: ExportFormat = ExportFormat.ICS;

  @ApiProperty({
    description: 'Start date for export (YYYY-MM-DD)',
    example: '2025-10-01',
    required: false,
  })
  @IsOptional()
  startDate?: string;

  @ApiProperty({
    description: 'End date for export (YYYY-MM-DD)',
    example: '2025-10-31',
    required: false,
  })
  @IsOptional()
  endDate?: string;
}
