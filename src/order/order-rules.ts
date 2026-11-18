import type {
  DeliveryStatus,
  OrderStatus,
  PaymentStatus,
} from '@prisma/client';

/**
 * Order rules. The three statuses move independently, with a few cross-checks:
 *  - only CONFIRMED orders can be shipped or delivered;
 *  - a delivered order can't be cancelled (refund it instead);
 *  - rejecting / cancelling releases the reserved stock (exactly once: the status
 *    update is conditional, see OrderService).
 */

export const ORDER_STATUS_FLOW: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'REJECTED', 'CANCELLED'],
  CONFIRMED: ['CANCELLED'],
  REJECTED: [],
  CANCELLED: [],
};

export const PAYMENT_STATUS_FLOW: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ['PAID', 'FAILED'],
  FAILED: ['PENDING', 'PAID'],
  PAID: ['REFUNDED'],
  REFUNDED: [],
};

export const DELIVERY_STATUS_FLOW: Record<DeliveryStatus, DeliveryStatus[]> = {
  NOT_SHIPPED: ['SENT_TO_DELIVERY'],
  // Back to NOT_SHIPPED covers a parcel returned before delivery.
  SENT_TO_DELIVERY: ['DELIVERED', 'NOT_SHIPPED'],
  DELIVERED: [],
};

export const STATUS_LABELS = {
  status: {
    PENDING: 'Pending',
    CONFIRMED: 'Confirmed',
    REJECTED: 'Rejected',
    CANCELLED: 'Cancelled',
  },
  payment: {
    PENDING: 'Pending',
    PAID: 'Paid',
    FAILED: 'Failed',
    REFUNDED: 'Refunded',
  },
  delivery: {
    NOT_SHIPPED: 'Not yet shipped',
    SENT_TO_DELIVERY: 'Sent to delivery company',
    DELIVERED: 'Delivered',
  },
  payMethod: {
    CASH: 'Cash on delivery',
    BARIDIMOB: 'BaridiMob',
    CIB: 'CIB card',
  },
} as const;

interface OrderState {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  deliveryStatus: DeliveryStatus;
  deliveryCompany?: string | null;
}

export function orderStatusError(
  order: OrderState,
  to: OrderStatus,
  reason?: string | null,
): string | null {
  if (order.status === to) return `Order is already ${to}`;
  if (!ORDER_STATUS_FLOW[order.status].includes(to)) {
    return `Cannot change an order from ${order.status} to ${to}`;
  }
  if (to === 'CANCELLED' && order.deliveryStatus === 'DELIVERED') {
    return 'A delivered order cannot be cancelled; refund the payment instead';
  }
  if ((to === 'REJECTED' || to === 'CANCELLED') && !reason?.trim()) {
    return `A reason is required to mark the order ${to}`;
  }
  return null;
}

export function paymentStatusError(
  order: OrderState,
  to: PaymentStatus,
): string | null {
  if (order.paymentStatus === to) return `Payment is already ${to}`;
  if (!PAYMENT_STATUS_FLOW[order.paymentStatus].includes(to)) {
    return `Cannot change payment from ${order.paymentStatus} to ${to}`;
  }
  return null;
}

export function deliveryStatusError(
  order: OrderState,
  to: DeliveryStatus,
  deliveryCompany?: string | null,
): string | null {
  if (order.deliveryStatus === to) return `Delivery is already ${to}`;
  if (!DELIVERY_STATUS_FLOW[order.deliveryStatus].includes(to)) {
    return `Cannot change delivery from ${order.deliveryStatus} to ${to}`;
  }
  if (
    (to === 'SENT_TO_DELIVERY' || to === 'DELIVERED') &&
    order.status !== 'CONFIRMED'
  ) {
    return 'Only confirmed orders can be shipped';
  }
  if (
    to === 'SENT_TO_DELIVERY' &&
    !(deliveryCompany ?? order.deliveryCompany)?.trim()
  ) {
    return 'Set the delivery company before sending the order';
  }
  return null;
}

/** Status moves that give the reserved units back to stock. */
export function releasesStock(from: OrderStatus, to: OrderStatus): boolean {
  return (
    (from === 'PENDING' || from === 'CONFIRMED') &&
    (to === 'REJECTED' || to === 'CANCELLED')
  );
}

/** Which admin actions make sense now (to enable/disable buttons). */
export function allowedOrderActions(order: OrderState) {
  return {
    status: ORDER_STATUS_FLOW[order.status].filter(
      (to) => orderStatusError(order, to, 'x') === null,
    ),
    payment: PAYMENT_STATUS_FLOW[order.paymentStatus],
    delivery: DELIVERY_STATUS_FLOW[order.deliveryStatus].filter(
      (to) => deliveryStatusError(order, to, 'x') === null,
    ),
  };
}

export function formatOrderRef(refNo: number): string {
  return `ORD-${String(refNo).padStart(6, '0')}`;
}

export function parseOrderRef(text: string): number | null {
  const m = /^(?:ord-?)?0*(\d{1,9})$/i.exec(text.trim());
  return m ? Number(m[1]) : null;
}
