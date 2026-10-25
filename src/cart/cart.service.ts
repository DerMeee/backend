import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import {
  CartResponseDto,
  WishlistItemResponseDto,
} from './dto/cart-response.dto';
import { catchServiceError } from '../utils/catch-service-error';

const PRODUCT_FIELDS = {
  id: true,
  name: true,
  brand: true,
  price: true,
  category: true,
  images: { orderBy: { order: 'asc' as const }, take: 1 },
};

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private async resolvePatient(userId: string) {
    const patient = await this.prisma.patient.findUnique({ where: { userId } });
    if (!patient) throw new ForbiddenException('Patient profile not found');
    return patient;
  }

  private async getOrCreateCart(patientId: string) {
    return this.prisma.cart.upsert({
      where: { patientId },
      create: { patientId },
      update: {},
      include: {
        items: {
          include: {
            product: { select: PRODUCT_FIELDS },
          },
        },
      },
    });
  }

  private buildCartResponse(cart: any): CartResponseDto {
    const items = cart.items.map((item: any) => ({
      id: item.id,
      quantity: item.quantity,
      product: {
        id: item.product.id,
        name: item.product.name,
        brand: item.product.brand,
        price: item.product.price,
        category: item.product.category,
        images: item.product.images.map((img: any) => ({
          id: img.id,
          url: img.url,
          isPrimary: img.isPrimary,
          order: img.order,
        })),
      },
    }));

    const total = items.reduce(
      (sum: number, item: any) => sum + item.product.price * item.quantity,
      0,
    );

    return { id: cart.id, items, total: Math.round(total * 100) / 100 };
  }

  // ── Cart ─────────────────────────────────────────────────────────────────────

  async getCart(userId: string): Promise<CartResponseDto> {
    try {
      const patient = await this.resolvePatient(userId);
      const cart = await this.getOrCreateCart(patient.id);
      return this.buildCartResponse(cart);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async addItem(userId: string, dto: AddToCartDto): Promise<CartResponseDto> {
    try {
      const patient = await this.resolvePatient(userId);

      const product = await this.prisma.product.findUnique({
        where: { id: dto.productId },
      });
      if (!product) throw new NotFoundException('Product not found');

      const cart = await this.getOrCreateCart(patient.id);

      const existing = await this.prisma.cartItem.findUnique({
        where: { cartId_productId: { cartId: cart.id, productId: dto.productId } },
      });

      if (existing) {
        await this.prisma.cartItem.update({
          where: { id: existing.id },
          data: { quantity: existing.quantity + dto.quantity },
        });
      } else {
        await this.prisma.cartItem.create({
          data: { cartId: cart.id, productId: dto.productId, quantity: dto.quantity },
        });
      }

      return this.getCart(userId);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async updateItem(
    userId: string,
    productId: string,
    dto: UpdateCartItemDto,
  ): Promise<CartResponseDto> {
    try {
      const patient = await this.resolvePatient(userId);
      const cart = await this.prisma.cart.findUnique({ where: { patientId: patient.id } });
      if (!cart) throw new NotFoundException('Cart not found');

      const item = await this.prisma.cartItem.findUnique({
        where: { cartId_productId: { cartId: cart.id, productId } },
      });
      if (!item) throw new NotFoundException('Item not in cart');

      await this.prisma.cartItem.update({
        where: { id: item.id },
        data: { quantity: dto.quantity },
      });

      return this.getCart(userId);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async removeItem(userId: string, productId: string): Promise<CartResponseDto> {
    try {
      const patient = await this.resolvePatient(userId);
      const cart = await this.prisma.cart.findUnique({ where: { patientId: patient.id } });
      if (!cart) throw new NotFoundException('Cart not found');

      const item = await this.prisma.cartItem.findUnique({
        where: { cartId_productId: { cartId: cart.id, productId } },
      });
      if (!item) throw new NotFoundException('Item not in cart');

      await this.prisma.cartItem.delete({ where: { id: item.id } });
      return this.getCart(userId);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async clearCart(userId: string): Promise<{ message: string }> {
    try {
      const patient = await this.resolvePatient(userId);
      const cart = await this.prisma.cart.findUnique({ where: { patientId: patient.id } });
      if (!cart) return { message: 'Cart is already empty' };

      await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
      return { message: 'Cart cleared' };
    } catch (error) {
      catchServiceError(error);
    }
  }

  // ── Wishlist ─────────────────────────────────────────────────────────────────

  async getWishlist(userId: string): Promise<WishlistItemResponseDto[]> {
    try {
      const patient = await this.resolvePatient(userId);

      const items = await this.prisma.wishlist.findMany({
        where: { patientId: patient.id },
        include: { product: { select: { ...PRODUCT_FIELDS } } },
        orderBy: { id: 'desc' },
      });

      return items.map((item: any) => ({
        id: item.id,
        product: {
          id: item.product.id,
          name: item.product.name,
          brand: item.product.brand,
          price: item.product.price,
          category: item.product.category,
          images: item.product.images.map((img: any) => ({
            id: img.id,
            url: img.url,
            isPrimary: img.isPrimary,
            order: img.order,
          })),
        },
        createdAt: item.createdAt,
      }));
    } catch (error) {
      catchServiceError(error);
    }
  }

  async addToWishlist(
    userId: string,
    productId: string,
  ): Promise<{ message: string }> {
    try {
      const patient = await this.resolvePatient(userId);

      const product = await this.prisma.product.findUnique({ where: { id: productId } });
      if (!product) throw new NotFoundException('Product not found');

      const exists = await this.prisma.wishlist.findUnique({
        where: { patientId_productId: { patientId: patient.id, productId } },
      });
      if (exists) throw new BadRequestException('Product already in wishlist');

      await this.prisma.wishlist.create({
        data: { patientId: patient.id, productId },
      });

      return { message: 'Added to wishlist' };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async removeFromWishlist(
    userId: string,
    productId: string,
  ): Promise<{ message: string }> {
    try {
      const patient = await this.resolvePatient(userId);

      const item = await this.prisma.wishlist.findUnique({
        where: { patientId_productId: { patientId: patient.id, productId } },
      });
      if (!item) throw new NotFoundException('Product not in wishlist');

      await this.prisma.wishlist.delete({
        where: { patientId_productId: { patientId: patient.id, productId } },
      });

      return { message: 'Removed from wishlist' };
    } catch (error) {
      catchServiceError(error);
    }
  }
}
