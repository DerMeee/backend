import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, Matches } from 'class-validator';

enum ExceptionType {
  CANCELLED = 'CANCELLED',
  ADDED = 'ADDED',
  CHANGED = 'CHANGED',
}

export class CreateExceptionDto {
  @IsDateString()
  @ApiProperty({ description: 'Date of the exception in YYYY-MM-DD format', type: String })
  date: string;

  @IsEnum(ExceptionType)
  @ApiProperty({ description: 'Type of exception', enum: ExceptionType })
  type: ExceptionType;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  @ApiProperty({ description: 'start time in HH:mm format', type: String, required: true })
  start?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  @ApiProperty({ description: 'end time in HH:mm format', type: String, required: true })
  end?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ description: 'Reason for the exception', type: String, required: false })
  reason?: string;
}
