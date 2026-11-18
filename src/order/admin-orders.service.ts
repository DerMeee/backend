import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { catchServiceError } from '../utils/catch-service-error';
import { dateRangeFilter } from '../common/dates';
import { paginate, resolveSort, skipTake } from '../common/pagination';
import type { Actor } from '../common/request-user';
import { OrderService } from './order.service';
import {
  allowedOrderActions,
  formatOrderRef,
  parseOrderRef,
  STATUS_LABELS,
} from './order-rules';
import type {
  AdminOrdersQueryDto,
  UpdateDeliveryDto,
  UpdateOrderStatusDto,
  UpdatePaymentStatusDto,
} from './dto/admin-order.dto';

const listInclude = {
  items: {
    select: {
      productId: true,
      productName: true,
      quantity: true,
      unitPrice: true,
    },
  },
  patient: {
    select: { user: { select: { id: true, name: true, phoneNumber: true } } },
  },
} satisfies Prisma.OrderInclude;

@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
  ) {}

  private where(q: AdminOrdersQueryDto): Prisma.OrderWhereInput {
    const and: Prisma.OrderWhereInput[] = [];
    const createdAt = dateRangeFilter(q.from, q.to);
    if (createdAt) and.push({ createdAt });
    if (q.status) and.push({ status: q.status });
    if (q.paymentStatus) and.push({ paymentStatus: q.paymentStatus });
    if (q.deliveryStatus) and.push({ deliveryStatus: q.deliveryStatus });
    if (q.payMethod) and.push({ payMethod: q.payMethod });
    if (q.wilaya?.trim())
      and.push({ wilaya: { contains: q.wilaya.trim(), mode: 'insensitive' } });
    if (q.commune?.trim())
      and.push({
        commune: { contains: q.commune.trim(), mode: 'insensitive' },
      });
    if (q.product?.trim()) {
      const p = q.product.trim();
      and.push({
        items: {
          some: {
            OR: [
              { productId: p },
              { productName: { contains: p, mode: 'insensitive' } },
            ],
          },
        },
      });
    }
    const customerMatch = (text: string): Prisma.OrderWhereInput => {
      const contains = { contains: text, mode: 'insensitive' as const };
      const digits = text.replace(/\s+/g, '');
      return {
        OR: [
          { recipientName: contains },
          { recipientPhone: { contains: digits } },
          { recipientPhone: contains },
          { patient: { user: { name: contains } } },
          { patient: { user: { phoneNumber: { contains: digits } } } },
        ],
      };
    };
    if (q.customer?.trim()) and.push(customerMatch(q.customer.trim()));
    if (q.search?.trim()) {
      const ref = parseOrderRef(q.search);
      const text = customerMatch(q.search.trim());
      and.push(ref !== null ? { OR: [{ refNo: ref }, text] } : text);
    }
    return { AND: and };
  }

  async list(q: AdminOrdersQueryDto) {
    try {
      const where = this.where(q);
      const orderBy = resolveSort<Prisma.OrderOrderByWithRelationInput>(
        q.sortBy,
        {
          createdAt: { createdAt: q.sortDir },
          totalAmount: { totalAmount: q.sortDir },
          refNo: { refNo: q.sortDir },
          updatedAt: { updatedAt: q.sortDir },
        },
        'createdAt',
      );
      const [total, rows] = await Promise.all([
        this.prisma.order.count({ where }),
        this.prisma.order.findMany({
          where,
          include: listInclude,
          orderBy: [orderBy, { id: q.sortDir }],
          ...skipTake(q.page, q.limit),
        }),
      ]);
      const data = rows.map((o) => ({
        id: o.id,
        reference: formatOrderRef(o.refNo),
        customer: {
          userId: o.patient.user.id,
          name: o.recipientName ?? o.patient.user.name,
          phoneNumber: o.recipientPhone ?? o.patient.user.phoneNumber,
        },
        wilaya: o.wilaya,
        commune: o.commune,
        items: o.items.map((i) => ({
          productId: i.productId,
          productName: i.productName,
          quantity: i.quantity,
        })),
        itemsCount: o.items.reduce((s, i) => s + i.quantity, 0),
        totalAmount: o.totalAmount,
        payMethod: o.payMethod,
        payMethodLabel: STATUS_LABELS.payMethod[o.payMethod],
        status: o.status,
        paymentStatus: o.paymentStatus,
        deliveryStatus: o.deliveryStatus,
        deliveryCompany: o.deliveryCompany,
        trackingNumber: o.trackingNumber,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      }));
      return paginate(data, total, q.page, q.limit);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async stats() {
    try {
      const [byStatus, byPayment, byDelivery, revenue] = await Promise.all([
        this.prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.order.groupBy({
          by: ['paymentStatus'],
          _count: { _all: true },
        }),
        this.prisma.order.groupBy({
          by: ['deliveryStatus'],
          where: { status: 'CONFIRMED' },
          _count: { _all: true },
        }),
        this.prisma.order.aggregate({
          where: { paymentStatus: 'PAID' },
          _sum: { totalAmount: true },
        }),
      ]);
      const toMap = <K extends string>(
        rows: Array<Record<string, unknown> & { _count: { _all: number } }>,
        key: string,
      ) =>
        Object.fromEntries(
          rows.map((r) => [r[key] as K, r._count._all]),
        ) as Record<K, number>;
      return {
        total: byStatus.reduce((a, r) => a + r._count._all, 0),
        byStatus: toMap(byStatus, 'status'),
        byPaymentStatus: toMap(byPayment, 'paymentStatus'),
        /** Confirmed orders only. */
        byDeliveryStatus: toMap(byDelivery, 'deliveryStatus'),
        paidRevenue: revenue._sum.totalAmount ?? 0,
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async detail(id: string) {
    try {
      const o = await this.prisma.order.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  sku: true,
                  status: true,
                  images: {
                    where: { isPrimary: true },
                    select: { url: true },
                    take: 1,
                  },
                },
              },
            },
          },
          patient: {
            select: {
              id: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phoneNumber: true,
                  status: true,
                  address: true,
                },
              },
            },
          },
          history: { orderBy: { createdAt: 'asc' } },
        },
      });
      if (!o) throw new NotFoundException('Order not found');

      const actorIds = [
        ...new Set(
          o.history.map((h) => h.actorId).filter((x): x is string => !!x),
        ),
      ];
      const actors = actorIds.length
        ? await this.prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, name: true, role: true },
          })
        : [];

      return {
        id: o.id,
        reference: formatOrderRef(o.refNo),
        status: o.status,
        paymentStatus: o.paymentStatus,
        deliveryStatus: o.deliveryStatus,
        labels: {
          status: STATUS_LABELS.status[o.status],
          payment: STATUS_LABELS.payment[o.paymentStatus],
          delivery: STATUS_LABELS.delivery[o.deliveryStatus],
          payMethod: STATUS_LABELS.payMethod[o.payMethod],
        },
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        closeReason: o.closeReason,
        customer: { patientId: o.patient.id, ...o.patient.user },
        deliveryAddress: {
          recipientName: o.recipientName,
          recipientPhone: o.recipientPhone,
          wilaya: o.wilaya,
          commune: o.commune,
          addressLine: o.addressLine,
          note: o.deliveryNote,
        },
        items: o.items.map((i) => ({
          id: i.id,
          productId: i.productId,
          productName: i.productName,
          sku: i.product.sku,
          productStatus: i.product.status,
          imageUrl: i.product.images[0]?.url ?? null,
          unitPrice: i.unitPrice,
          quantity: i.quantity,
          subtotal: Math.round(i.unitPrice * i.quantity * 100) / 100,
        })),
        totalAmount: o.totalAmount,
        payment: {
          method: o.payMethod,
          status: o.paymentStatus,
          paidAt: o.paidAt,
        },
        delivery: {
          status: o.deliveryStatus,
          company: o.deliveryCompany,
          trackingNumber: o.trackingNumber,
          shippedAt: o.shippedAt,
          deliveredAt: o.deliveredAt,
        },
        history: o.history.map((h) => ({
          ...h,
          actor: h.actorId
            ? (actors.find((a) => a.id === h.actorId) ?? { id: h.actorId })
            : null,
        })),
        allowedActions: allowedOrderActions(o),
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async setStatus(id: string, dto: UpdateOrderStatusDto, actor: Actor) {
    try {
      await this.orders.changeStatus(
        await this.orders.load(id),
        dto.status,
        actor,
        dto.reason,
      );
      return this.detail(id);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async setPayment(id: string, dto: UpdatePaymentStatusDto, actor: Actor) {
    try {
      await this.orders.changePayment(
        await this.orders.load(id),
        dto.paymentStatus,
        actor,
        dto.note,
      );
      return this.detail(id);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async setDelivery(id: string, dto: UpdateDeliveryDto, actor: Actor) {
    try {
      await this.orders.updateDelivery(await this.orders.load(id), dto, actor);
      return this.detail(id);
    } catch (error) {
      catchServiceError(error);
    }
  }
}
