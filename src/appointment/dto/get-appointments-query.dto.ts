import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class GetAppointmentsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @ApiProperty({ default: 1 })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @ApiProperty({ default: 10 })
  limit?: number = 10;

  @IsOptional()
  @IsString()
  @ApiProperty({type: String})
  dateFrom?: string; // Format: YYYY-MM-DD

  @IsOptional()
  @IsString()
  @ApiProperty({type: String})
  dateTo?: string; // Format: YYYY-MM-DD
}
