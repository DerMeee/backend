import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryStatus,
  Notification,
  OrderStatus,
  OrderStatusField,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { PaginatedResponseDto } from '../appointment/dto/pagination-resp.dto';
import { catchServiceError } from '../utils/catch-service-error';
import { StockService } from '../inventory/stock.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/audit-actions';
import {
  NotificationsService,
  NotificationType,
} from '../notifications/notifications.service';
import type { Actor } from '../common/request-user';
import {
  deliveryStatusError,
  formatOrderRef,
  orderStatusError,
  paymentStatusError,
  releasesStock,
  STATUS_LABELS,
} from './order-rules';

export const orderInclude = {
  items: true,
  patient: { select: { userId: true } },
} satisfies Prisma.OrderInclude;

type OrderWithItems = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private async resolvePatient(userId: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { userId },
      include: { user: { include: { address: true } } },
    });
    if (!patient) throw new ForbiddenException('Patient profile not found');
    return patient;
  }

  toResponse(
    order:
      | OrderWithItems
      | Prisma.OrderGetPayload<{ include: { items: true } }>,
  ): OrderResponseDto {
    const items = order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      subtotal: round2(item.unitPrice * item.quantity),
    }));
    return {
      id: order.id,
      reference: formatOrderRef(order.refNo),
      patientId: order.patientId,
      payMethod: order.payMethod,
      status: order.status,
      paymentStatus: order.paymentStatus,
      deliveryStatus: order.deliveryStatus,
      items,
      total:
        order.totalAmount || round2(items.reduce((s, i) => s + i.subtotal, 0)),
      delivery: {
        recipientName: order.recipientName,
        recipientPhone: order.recipientPhone,
        wilaya: order.wilaya,
        commune: order.commune,
        addressLine: order.addressLine,
        note: order.deliveryNote,
        company: order.deliveryCompany,
        trackingNumber: order.trackingNumber,
        shippedAt: order.shippedAt,
        deliveredAt: order.deliveredAt,
      },
      paidAt: order.paidAt,
      closeReason: order.closeReason,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  // ── Patient operations ────────────────────────────────────────────────────────

  /**
   * Checkout. In one transaction: re-reads the cart, checks every product is still
   * published, reserves the stock (fails if any item is short), snapshots prices and
   * the delivery address, and empties the cart.
   */
  async createFromCart(
    userId: string,
    dto: CreateOrderDto,
  ): Promise<OrderResponseDto> {
    try {
      const patient = await this.resolvePatient(userId);
      const profileAddress = patient.user.address;
      const delivery = {
        recipientName: dto.recipientName?.trim() || patient.user.name,
        recipientPhone: dto.recipientPhone?.trim() || patient.user.phoneNumber,
        wilaya: dto.wilaya?.trim() || profileAddress?.state || null,
        commune: dto.commune?.trim() || profileAddress?.city || null,
        addressLine: dto.addressLine?.trim() || profileAddress?.street || null,
        deliveryNote: dto.deliveryNote?.trim() || null,
      };
      const missing = (
        ['recipientPhone', 'wilaya', 'commune', 'addressLine'] as const
      ).filter((k) => !delivery[k]);
      if (missing.length) {
        throw new BadRequestException(
          `Delivery information missing: ${missing.join(', ')}`,
        );
      }

      let alerts: Notification[] = [];
      const order = await this.prisma.$transaction(async (tx) => {
        const cart = await tx.cart.findUnique({
          where: { patientId: patient.id },
          include: { items: { include: { product: true } } },
        });
        if (!cart || cart.items.length === 0) {
          throw new BadRequestException('Your cart is empty');
        }
        const unavailable = cart.items.filter(
          (i) => i.product.status !== 'PUBLISHED',
        );
        if (unavailable.length) {
          throw new BadRequestException(
            `No longer available: ${unavailable.map((i) => i.product.name).join(', ')}. Remove them from your cart.`,
          );
        }

        const total = round2(
          cart.items.reduce((s, i) => s + i.product.price * i.quantity, 0),
        );
        const created = await tx.order.create({
          data: {
            patientId: patient.id,
            payMethod: dto.payMethod,
            totalAmount: total,
            ...delivery,
            items: {
              create: cart.items.map((item) => ({
                productId: item.productId,
                productName: item.product.name,
                unitPrice: item.product.price,
                quantity: item.quantity,
              })),
            },
          },
          include: orderInclude,
        });

        const results = await this.stock.adjustMany(
          tx,
          cart.items.map((i) => ({
            productId: i.productId,
            delta: -i.quantity,
            reason: 'ORDER_PLACED' as const,
            actorId: userId,
            orderId: created.id,
          })),
        );
        await this.history(
          tx,
          created.id,
          'STATUS',
          null,
          'PENDING',
          { userId, role: 'PATIENT' },
          'Order placed',
        );
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

        alerts = [
          ...(await this.stock.lowStockAlerts(tx, results)),
          ...(await this.notifications.notifyAdmins(tx, {
            type: NotificationType.ORDER_PLACED,
            content: `New order ${formatOrderRef(created.refNo)} from ${delivery.recipientName} (${delivery.wilaya}) — ${total} DZD, ${STATUS_LABELS.payMethod[dto.payMethod]}.`,
            entityType: 'Order',
            entityId: created.id,
            link: `/admin/orders/${created.id}`,
          })),
        ];
        return created;
      });
      this.notifications.publish(alerts);
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
      const page = Number(query.page) || 1;
      const limit = Math.min(Number(query.limit) || 10, 100);
      const [totalCount, orders] = await Promise.all([
        this.prisma.order.count({ where: { patientId: patient.id } }),
        this.prisma.order.findMany({
          where: { patientId: patient.id },
          include: { items: true },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);
      return new PaginatedResponseDto(
        orders.map((o) => this.toResponse(o)),
        page,
        limit,
        totalCount,
      );
    } catch (error) {
      catchServiceError(error);
    }
  }

  async getOrderById(
    userId: string,
    orderId: string,
  ): Promise<OrderResponseDto> {
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

  /** A patient can cancel their own order while it is still PENDING. Stock is released. */
  async cancelOrder(
    userId: string,
    orderId: string,
    reason?: string,
  ): Promise<OrderResponseDto> {
    try {
      const patient = await this.resolvePatient(userId);
      const order = await this.prisma.order.findFirst({
        where: { id: orderId, patientId: patient.id },
        include: orderInclude,
      });
      if (!order) throw new NotFoundException('Order not found');
      if (order.status !== 'PENDING') {
        throw new BadRequestException(
          `Cannot cancel an order that is already ${order.status.toLowerCase()}. Contact Dermee support.`,
        );
      }
      const updated = await this.changeStatus(
        order,
        'CANCELLED',
        { userId, role: 'PATIENT' },
        reason?.trim() || 'Cancelled by the customer',
      );
      return this.toResponse(updated);
    } catch (error) {
      catchServiceError(error);
    }
  }

  // ── Status changes (shared by patient cancel and admin actions) ──────────────

  async load(orderId: string): Promise<OrderWithItems> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: orderInclude,
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async changeStatus(
    order: OrderWithItems,
    to: OrderStatus,
    actor: Pick<Actor, 'userId' | 'role'> & Partial<Actor>,
    reason?: string,
  ): Promise<OrderWithItems> {
    const err = orderStatusError(order, to, reason);
    if (err) throw new BadRequestException(err);

    let alerts: Notification[] = [];
    const updated = await this.prisma.$transaction(async (tx) => {
      // Conditional: if two admins act at once, only one wins, so stock is released once.
      const res = await tx.order.updateMany({
        where: { id: order.id, status: order.status },
        data: {
          status: to,
          ...(to === 'REJECTED' || to === 'CANCELLED'
            ? { closeReason: reason?.trim() ?? null }
            : {}),
        },
      });
      if (res.count === 0)
        throw new ConflictException(
          'Order changed meanwhile, reload and retry',
        );

      if (releasesStock(order.status, to)) {
        await this.stock.adjustMany(
          tx,
          order.items.map((i) => ({
            productId: i.productId,
            delta: i.quantity,
            reason: 'ORDER_RELEASED' as const,
            actorId: actor.userId,
            orderId: order.id,
            note: `Order ${to.toLowerCase()}`,
          })),
        );
      }
      await this.history(
        tx,
        order.id,
        'STATUS',
        order.status,
        to,
        actor,
        reason,
      );
      await this.auditIfAdmin(
        tx,
        actor,
        AuditAction.ORDER_STATUS_CHANGED,
        order,
        { status: order.status },
        { status: to, reason },
      );
      alerts = await this.notifyCustomer(
        tx,
        order,
        actor,
        `Your order ${formatOrderRef(order.refNo)} is now ${STATUS_LABELS.status[to].toLowerCase()}${reason && to !== 'CONFIRMED' ? `: ${reason}` : '.'}`,
      );
      return tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: orderInclude,
      });
    });
    this.notifications.publish(alerts);
    return updated;
  }

  async changePayment(
    order: OrderWithItems,
    to: PaymentStatus,
    actor: Actor,
    note?: string,
  ) {
    const err = paymentStatusError(order, to);
    if (err) throw new BadRequestException(err);
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.order.updateMany({
        where: { id: order.id, paymentStatus: order.paymentStatus },
        data: {
          paymentStatus: to,
          ...(to === 'PAID' ? { paidAt: new Date() } : {}),
        },
      });
      if (res.count === 0)
        throw new ConflictException(
          'Order changed meanwhile, reload and retry',
        );
      await this.history(
        tx,
        order.id,
        'PAYMENT',
        order.paymentStatus,
        to,
        actor,
        note,
      );
      await this.auditIfAdmin(
        tx,
        actor,
        AuditAction.ORDER_PAYMENT_STATUS_CHANGED,
        order,
        { paymentStatus: order.paymentStatus },
        { paymentStatus: to, note },
      );
      return tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: orderInclude,
      });
    });
  }

  /** Delivery status change and/or delivery info update (company, tracking, note). */
  async updateDelivery(
    order: OrderWithItems,
    patch: {
      deliveryStatus?: DeliveryStatus;
      deliveryCompany?: string;
      trackingNumber?: string;
      note?: string;
    },
    actor: Actor,
  ) {
    const to =
      patch.deliveryStatus && patch.deliveryStatus !== order.deliveryStatus
        ? patch.deliveryStatus
        : undefined;
    if (to) {
      const err = deliveryStatusError(order, to, patch.deliveryCompany);
      if (err) throw new BadRequestException(err);
    }
    const info: Prisma.OrderUpdateManyMutationInput = {};
    if (patch.deliveryCompany !== undefined)
      info.deliveryCompany = patch.deliveryCompany.trim() || null;
    if (patch.trackingNumber !== undefined)
      info.trackingNumber = patch.trackingNumber.trim() || null;
    if (!to && Object.keys(info).length === 0 && !patch.note?.trim()) {
      throw new BadRequestException('Nothing to update');
    }

    let alerts: Notification[] = [];
    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.order.updateMany({
        where: { id: order.id, deliveryStatus: order.deliveryStatus },
        data: {
          ...info,
          ...(to ? { deliveryStatus: to } : {}),
          ...(to === 'SENT_TO_DELIVERY' ? { shippedAt: new Date() } : {}),
          ...(to === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
          ...(to === 'NOT_SHIPPED' ? { shippedAt: null } : {}),
        },
      });
      if (res.count === 0)
        throw new ConflictException(
          'Order changed meanwhile, reload and retry',
        );
      const details = [
        patch.deliveryCompany !== undefined
          ? `company: ${patch.deliveryCompany || '—'}`
          : null,
        patch.trackingNumber !== undefined
          ? `tracking: ${patch.trackingNumber || '—'}`
          : null,
        patch.note?.trim() || null,
      ]
        .filter(Boolean)
        .join(' · ');
      // A row even without a status change: this is the "delivery updates" timeline.
      await this.history(
        tx,
        order.id,
        'DELIVERY',
        order.deliveryStatus,
        to ?? order.deliveryStatus,
        actor,
        details || null,
      );
      await this.auditIfAdmin(
        tx,
        actor,
        AuditAction.ORDER_DELIVERY_UPDATED,
        order,
        {
          deliveryStatus: order.deliveryStatus,
          deliveryCompany: order.deliveryCompany,
          trackingNumber: order.trackingNumber,
        },
        {
          deliveryStatus: to ?? order.deliveryStatus,
          ...info,
          note: patch.note,
        },
      );
      if (to) {
        alerts = await this.notifyCustomer(
          tx,
          order,
          actor,
          to === 'SENT_TO_DELIVERY'
            ? `Your order ${formatOrderRef(order.refNo)} was handed to ${patch.deliveryCompany ?? order.deliveryCompany}${patch.trackingNumber ? ` (tracking ${patch.trackingNumber})` : ''}.`
            : `Your order ${formatOrderRef(order.refNo)}: ${STATUS_LABELS.delivery[to].toLowerCase()}.`,
        );
      }
      return tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: orderInclude,
      });
    });
    this.notifications.publish(alerts);
    return updated;
  }

  private history(
    tx: Prisma.TransactionClient,
    orderId: string,
    field: OrderStatusField,
    fromValue: string | null,
    toValue: string,
    actor: Pick<Actor, 'userId' | 'role'>,
    note?: string | null,
  ) {
    return tx.orderStatusHistory.create({
      data: {
        orderId,
        field,
        fromValue,
        toValue,
        actorId: actor.userId,
        actorRole: actor.role,
        note: note?.trim() || null,
      },
    });
  }

  private async auditIfAdmin(
    tx: Prisma.TransactionClient,
    actor: Pick<Actor, 'userId' | 'role'> & Partial<Actor>,
    action: (typeof AuditAction)[keyof typeof AuditAction],
    order: OrderWithItems,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ) {
    if (actor.role !== 'ADMIN') return;
    await this.audit.log(tx, {
      actor: actor as Actor,
      action,
      entityType: AuditEntity.ORDER,
      entityId: order.id,
      before,
      after,
      metadata: { reference: formatOrderRef(order.refNo) },
    });
  }

  private async notifyCustomer(
    tx: Prisma.TransactionClient,
    order: OrderWithItems,
    actor: Pick<Actor, 'role'>,
    content: string,
  ) {
    if (actor.role === 'PATIENT') return [];
    return this.notifications.notifyUser(tx, order.patient.userId, {
      type: NotificationType.ORDER_STATUS_CHANGED,
      content,
      entityType: 'Order',
      entityId: order.id,
    });
  }
}
