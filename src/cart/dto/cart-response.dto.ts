import { ApiProperty } from '@nestjs/swagger';
import { ProductImageDto } from '../../product/dto/product-response.dto';

export class CartProductDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  brand: string | null;

  @ApiProperty()
  price: number;

  @ApiProperty({ nullable: true })
  category: string | null;

  @ApiProperty({ type: [ProductImageDto] })
  images: ProductImageDto[];
}

export class CartItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  quantity: number;

  @ApiProperty({ type: CartProductDto })
  product: CartProductDto;
}

export class CartResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: [CartItemResponseDto] })
  items: CartItemResponseDto[];

  @ApiProperty({ description: 'Total price of all items' })
  total: number;
}

export class WishlistItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: CartProductDto })
  product: CartProductDto;

  @ApiProperty()
  createdAt: Date;
}
