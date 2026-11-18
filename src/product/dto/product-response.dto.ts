import { ApiProperty } from '@nestjs/swagger';

export class ProductImageDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  url: string;

  @ApiProperty()
  isPrimary: boolean;

  @ApiProperty()
  order: number;
}

export class ProductResponseDto {
  @ApiProperty({ nullable: true, required: false })
  sku?: string | null;

  @ApiProperty({ description: 'False when stock is 0' })
  inStock: boolean;

  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ nullable: true })
  brand: string | null;

  @ApiProperty()
  price: number;

  @ApiProperty({ nullable: true })
  category: string | null;

  @ApiProperty()
  rating: number;

  @ApiProperty({ type: [ProductImageDto] })
  images: ProductImageDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
