import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { CartService } from './cart.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import {
  CartResponseDto,
  WishlistItemResponseDto,
} from './dto/cart-response.dto';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-aut.guard';
import { CurrentUser } from '../auth/decorator/current-user.decorator';

@ApiTags('cart')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @ApiOperation({ summary: 'Get my cart' })
  @ApiOkResponse({ type: CartResponseDto })
  @ApiForbiddenResponse({ description: 'Patient profile not found' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @Get()
  getCart(@CurrentUser() user: any): Promise<CartResponseDto> {
    return this.cartService.getCart(user.userId);
  }

  @ApiOperation({ summary: 'Add a product to cart (creates cart if needed)' })
  @ApiOkResponse({ type: CartResponseDto })
  @ApiNotFoundResponse({ description: 'Product not found' })
  @ApiForbiddenResponse({ description: 'Patient profile not found' })
  @ApiBadRequestResponse({ description: 'Validation error' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @Post('items')
  addItem(
    @Body() dto: AddToCartDto,
    @CurrentUser() user: any,
  ): Promise<CartResponseDto> {
    return this.cartService.addItem(user.userId, dto);
  }

  @ApiOperation({ summary: 'Update quantity of a cart item' })
  @ApiOkResponse({ type: CartResponseDto })
  @ApiNotFoundResponse({ description: 'Item not in cart' })
  @ApiForbiddenResponse({ description: 'Patient profile not found' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @Patch('items/:productId')
  updateItem(
    @Param('productId') productId: string,
    @Body() dto: UpdateCartItemDto,
    @CurrentUser() user: any,
  ): Promise<CartResponseDto> {
    return this.cartService.updateItem(user.userId, productId, dto);
  }

  @ApiOperation({ summary: 'Remove a product from cart' })
  @ApiOkResponse({ type: CartResponseDto })
  @ApiNotFoundResponse({ description: 'Item not in cart' })
  @ApiForbiddenResponse({ description: 'Patient profile not found' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @Delete('items/:productId')
  removeItem(
    @Param('productId') productId: string,
    @CurrentUser() user: any,
  ): Promise<CartResponseDto> {
    return this.cartService.removeItem(user.userId, productId);
  }

  @ApiOperation({ summary: 'Clear all items from cart' })
  @ApiOkResponse({ description: 'Cart cleared' })
  @ApiForbiddenResponse({ description: 'Patient profile not found' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @Delete()
  clearCart(@CurrentUser() user: any) {
    return this.cartService.clearCart(user.userId);
  }

  // ── Wishlist ───────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Get my wishlist' })
  @ApiOkResponse({ type: [WishlistItemResponseDto] })
  @ApiForbiddenResponse({ description: 'Patient profile not found' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @Get('wishlist')
  getWishlist(@CurrentUser() user: any): Promise<WishlistItemResponseDto[]> {
    return this.cartService.getWishlist(user.userId);
  }

  @ApiOperation({ summary: 'Add a product to wishlist' })
  @ApiCreatedResponse({ description: 'Added to wishlist' })
  @ApiBadRequestResponse({ description: 'Already in wishlist' })
  @ApiNotFoundResponse({ description: 'Product not found' })
  @ApiForbiddenResponse({ description: 'Patient profile not found' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @Post('wishlist/:productId')
  addToWishlist(
    @Param('productId') productId: string,
    @CurrentUser() user: any,
  ) {
    return this.cartService.addToWishlist(user.userId, productId);
  }

  @ApiOperation({ summary: 'Remove a product from wishlist' })
  @ApiOkResponse({ description: 'Removed from wishlist' })
  @ApiNotFoundResponse({ description: 'Product not in wishlist' })
  @ApiForbiddenResponse({ description: 'Patient profile not found' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @Delete('wishlist/:productId')
  removeFromWishlist(
    @Param('productId') productId: string,
    @CurrentUser() user: any,
  ) {
    return this.cartService.removeFromWishlist(user.userId, productId);
  }
}
