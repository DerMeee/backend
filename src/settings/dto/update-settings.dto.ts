import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateSettingsDto {
  @ApiPropertyOptional({
    example: 24,
    description: 'Hours before the visit that count as URGENT',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  urgentHours?: number;

  @ApiPropertyOptional({
    example: 72,
    description: 'Hours before the visit that count as MEDIUM',
  })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(2160)
  mediumHours?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  defaultLowStockThreshold?: number;
}
