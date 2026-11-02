import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsPositive,
  MinLength,
  IsArray,
  IsUrl,
} from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ example: 'Vitamin C 1000mg' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ required: false, example: 'High-potency vitamin C supplement' })
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
}
