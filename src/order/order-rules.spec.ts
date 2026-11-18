import {
  allowedOrderActions,
  deliveryStatusError,
  formatOrderRef,
  orderStatusError,
  parseOrderRef,
  paymentStatusError,
  releasesStock,
} from './order-rules';

const base = {
  status: 'PENDING' as const,
  paymentStatus: 'PENDING' as const,
  deliveryStatus: 'NOT_SHIPPED' as const,
  deliveryCompany: null,
};

describe('order rules', () => {
  it('order status: pending can be confirmed, rejected or cancelled', () => {
    expect(orderStatusError(base, 'CONFIRMED')).toBeNull();
    expect(orderStatusError(base, 'REJECTED', 'Out of stock')).toBeNull();
    expect(orderStatusError(base, 'CANCELLED', 'Customer request')).toBeNull();
  });

  it('order status: reject / cancel need a reason; terminal states are final', () => {
    expect(orderStatusError(base, 'REJECTED')).toMatch(/reason/);
    expect(
      orderStatusError({ ...base, status: 'REJECTED' }, 'CONFIRMED'),
    ).toMatch(/Cannot change/);
    expect(
      orderStatusError({ ...base, status: 'CONFIRMED' }, 'REJECTED', 'x'),
    ).toMatch(/Cannot change/);
  });

  it('a delivered order cannot be cancelled', () => {
    expect(
      orderStatusError(
        { ...base, status: 'CONFIRMED', deliveryStatus: 'DELIVERED' },
        'CANCELLED',
        'x',
      ),
    ).toMatch(/delivered/i);
  });

  it('payment status moves independently', () => {
    expect(paymentStatusError(base, 'PAID')).toBeNull();
    expect(
      paymentStatusError({ ...base, paymentStatus: 'PAID' }, 'REFUNDED'),
    ).toBeNull();
    expect(paymentStatusError(base, 'REFUNDED')).toMatch(/Cannot change/);
    expect(
      paymentStatusError({ ...base, paymentStatus: 'REFUNDED' }, 'PAID'),
    ).toMatch(/Cannot change/);
  });

  it('only confirmed orders ship, and sending needs a delivery company', () => {
    expect(deliveryStatusError(base, 'SENT_TO_DELIVERY', 'Yalidine')).toMatch(
      /confirmed/,
    );
    const confirmed = { ...base, status: 'CONFIRMED' as const };
    expect(deliveryStatusError(confirmed, 'SENT_TO_DELIVERY')).toMatch(
      /delivery company/,
    );
    expect(
      deliveryStatusError(confirmed, 'SENT_TO_DELIVERY', 'Yalidine'),
    ).toBeNull();
    expect(deliveryStatusError(confirmed, 'DELIVERED')).toMatch(
      /Cannot change/,
    );
    expect(
      deliveryStatusError(
        { ...confirmed, deliveryStatus: 'SENT_TO_DELIVERY' },
        'DELIVERED',
      ),
    ).toBeNull();
  });

  it('stock is released only when a live order is rejected or cancelled', () => {
    expect(releasesStock('PENDING', 'REJECTED')).toBe(true);
    expect(releasesStock('CONFIRMED', 'CANCELLED')).toBe(true);
    expect(releasesStock('PENDING', 'CONFIRMED')).toBe(false);
    expect(releasesStock('CANCELLED', 'CANCELLED')).toBe(false);
  });

  it('lists the allowed actions', () => {
    expect(allowedOrderActions(base)).toEqual({
      status: ['CONFIRMED', 'REJECTED', 'CANCELLED'],
      payment: ['PAID', 'FAILED'],
      delivery: [],
    });
  });

  it('formats and parses references', () => {
    expect(formatOrderRef(45)).toBe('ORD-000045');
    expect(parseOrderRef('ORD-000045')).toBe(45);
    expect(parseOrderRef('nope')).toBeNull();
  });
});
