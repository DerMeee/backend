import { IsDateString, IsEnum, IsOptional, IsString, Matches } from 'class-validator';

enum ExceptionType {
  CANCELLED = 'CANCELLED',
  ADDED = 'ADDED',
  CHANGED = 'CHANGED',
}

export class CreateExceptionDto {
  @IsDateString()
  date: string;

  @IsEnum(ExceptionType)
  type: ExceptionType;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  start?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  end?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
