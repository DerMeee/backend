import { IsOptional, IsInt, Min, Max, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class GetProductsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @ApiProperty({ default: 1, required: false })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @ApiProperty({ default: 10, required: false })
  limit?: number = 10;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'Filter by category' })
  category?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'Search by name or brand' })
  search?: string;
}
