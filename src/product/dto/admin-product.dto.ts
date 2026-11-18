import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductStatus } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';
import { ListQueryDto } from '../../common/dto/list-query.dto';

export const PRODUCT_SORTS = [
  'createdAt',
  'name',
  'price',
  'stock',
  'updatedAt',
] as const;
export const STOCK_LEVELS = ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] as const;

/** `search` matches name, SKU and brand. Archived products only appear with status=ARCHIVED. */
export class AdminProductsQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: ProductStatus })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  @ApiPropertyOptional({ enum: STOCK_LEVELS })
  @IsOptional()
  @IsIn(STOCK_LEVELS)
  stockLevel?: (typeof STOCK_LEVELS)[number];

  @ApiPropertyOptional({ enum: PRODUCT_SORTS, default: 'createdAt' })
  declare sortBy?: string;
}

export class SetProductStatusDto {
  @ApiProperty({ enum: ['PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'] })
  @IsEnum(ProductStatus)
  status: ProductStatus;
}

export class StockAdjustmentDto {
  @ApiProperty({
    example: -3,
    description:
      'Units to add (positive) or remove (negative). Result can never go below 0.',
  })
  @IsInt()
  @NotEquals(0)
  @Min(-1_000_000)
  @Max(1_000_000)
  delta: number;

  @ApiPropertyOptional({
    enum: ['ADJUSTMENT', 'RETURN'],
    default: 'ADJUSTMENT',
  })
  @IsOptional()
  @IsIn(['ADJUSTMENT', 'RETURN'])
  reason?: 'ADJUSTMENT' | 'RETURN';

  @ApiPropertyOptional({ example: 'Inventory count, 2 damaged units' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
