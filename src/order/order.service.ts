import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderState } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStateDto } from './dto/update-order-state.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { PaginatedResponseDto } from '../appointment/dto/pagination-resp.dto';
import { catchServiceError } from '../utils/catch-service-error';

@Injectable()
export class OrderService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private async resolvePatient(userId: string) {
    const patient = await this.prisma.patient.findUnique({ where: { userId } });
    if (!patient) throw new ForbiddenException('Patient profile not found');
    return patient;
  }

  private toResponse(order: any): OrderResponseDto {
    const items = order.items.map((item: any) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      subtotal: Math.round(item.unitPrice * item.quantity * 100) / 100,
    }));

    const total = items.reduce(
      (sum: number, item: any) => sum + item.subtotal,
      0,
    );

    return {
      id: order.id,
      patientId: order.patientId,
      payMethod: order.payMethod,
      state: order.state,
      items,
      total: Math.round(total * 100) / 100,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  // ── Patient operations ────────────────────────────────────────────────────────

  async createFromCart(userId: string, dto: CreateOrderDto): Promise<OrderResponseDto> {
    try {
      const patient = await this.resolvePatient(userId);

      const cart = await this.prisma.cart.findUnique({
        where: { patientId: patient.id },
        include: {
          items: {
            include: { product: true },
          },
        },
      });

      if (!cart || cart.items.length === 0) {
        throw new BadRequestException('Your cart is empty');
      }

      const order = await this.prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            patientId: patient.id,
            payMethod: dto.payMethod,
            state: OrderState.PENDING,
            items: {
              create: cart.items.map((item) => ({
                productId: item.productId,
                productName: item.product.name,
                unitPrice: item.product.price,
                quantity: item.quantity,
              })),
            },
          },
          include: { items: true },
        });

        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

        return created;
      });

      return this.toResponse(order);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async getMyOrders(
    userId: string,
    query: { page?: number; limit?: number },
  ): Promise<PaginatedResponseDto<OrderResponseDto>> {
    try {
      const patient = await this.resolvePatient(userId);

      const page = query.page || 1;
      const limit = query.limit || 10;
      const skip = (page - 1) * limit;

      const [totalCount, orders] = await Promise.all([
        this.prisma.order.count({ where: { patientId: patient.id } }),
        this.prisma.order.findMany({
          where: { patientId: patient.id },
          include: { items: true },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: orders.map((o) => this.toResponse(o)),
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async getOrderById(userId: string, orderId: string): Promise<OrderResponseDto> {
    try {
      const patient = await this.resolvePatient(userId);

      const order = await this.prisma.order.findFirst({
        where: { id: orderId, patientId: patient.id },
        include: { items: true },
      });

      if (!order) throw new NotFoundException('Order not found');
      return this.toResponse(order);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async cancelOrder(userId: string, orderId: string): Promise<OrderResponseDto> {
    try {
      const patient = await this.resolvePatient(userId);

      const order = await this.prisma.order.findFirst({
        where: { id: orderId, patientId: patient.id },
        include: { items: true },
      });

      if (!order) throw new NotFoundException('Order not found');
      if (order.state !== OrderState.PENDING) {
        throw new BadRequestException(
          `Cannot cancel an order that is already ${order.state.toLowerCase()}`,
        );
      }

      const updated = await this.prisma.order.update({
        where: { id: orderId },
        data: { state: OrderState.CANCELLED },
        include: { items: true },
      });

      return this.toResponse(updated);
    } catch (error) {
      catchServiceError(error);
    }
  }

  // ── Admin operations ──────────────────────────────────────────────────────────

  async getAllOrders(
    query: { page?: number; limit?: number; state?: OrderState },
  ): Promise<PaginatedResponseDto<OrderResponseDto>> {
    try {
      const page = query.page || 1;
      const limit = query.limit || 10;
      const skip = (page - 1) * limit;

      const where = query.state ? { state: query.state } : {};

      const [totalCount, orders] = await Promise.all([
        this.prisma.order.count({ where }),
        this.prisma.order.findMany({
          where,
          include: { items: true },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: orders.map((o) => this.toResponse(o)),
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async updateOrderState(
    orderId: string,
    dto: UpdateOrderStateDto,
  ): Promise<OrderResponseDto> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!order) throw new NotFoundException('Order not found');

      if (order.state === OrderState.CANCELLED) {
        throw new BadRequestException('Cannot update a cancelled order');
      }

      const updated = await this.prisma.order.update({
        where: { id: orderId },
        data: { state: dto.state },
        include: { items: true },
      });

      return this.toResponse(updated);
    } catch (error) {
      catchServiceError(error);
    }
  }
}
