import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsPositive,
  MinLength,
  IsArray,
  IsUrl,
  IsInt,
  Min,
  Max,
  IsIn,
  MaxLength,
  Matches,
} from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ example: 'Vitamin C 1000mg' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({
    required: false,
    example: 'High-potency vitamin C supplement',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false, example: 'NaturePlus' })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiProperty({ example: 12.99 })
  @IsNumber()
  @IsPositive()
  price: number;

  @ApiProperty({ required: false, example: 'Vitamins' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Initial image URLs. First URL becomes primary.',
    example: ['https://example.com/img1.png'],
  })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  images?: string[];

  @ApiPropertyOptional({
    example: 'DRM-SPF50-001',
    description: 'Product reference (unique)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  // Empty string clears the SKU on update.
  @Matches(/^[A-Za-z0-9._/-]*$/, {
    message: 'sku may only contain letters, digits and . _ - /',
  })
  sku?: string;

  @ApiPropertyOptional({
    example: 25,
    default: 0,
    description: 'Initial stock (later changes: stock adjustments)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  stock?: number;

  @ApiPropertyOptional({
    example: 5,
    description: 'Low-stock alert level (default from settings)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  lowStockThreshold?: number;

  @ApiPropertyOptional({
    enum: ['PUBLISHED', 'UNPUBLISHED'],
    default: 'PUBLISHED',
  })
  @IsOptional()
  @IsIn(['PUBLISHED', 'UNPUBLISHED'])
  status?: 'PUBLISHED' | 'UNPUBLISHED';
}
