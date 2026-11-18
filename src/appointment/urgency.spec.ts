import {
  computeUrgency,
  formatReservationRef,
  parseReservationRef,
  urgencyWhere,
} from './urgency';

const now = new Date('2026-11-02T10:00:00Z');
const t = { urgentHours: 24, mediumHours: 72 };
const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000);

describe('computeUrgency', () => {
  it('flags an unconfirmed visit whose time has passed as OVERDUE, top priority', () => {
    const u = computeUrgency(inHours(-1), 'PENDING', now, t);
    expect(u.level).toBe('OVERDUE');
    expect(u.priority).toBe(0);
    expect(computeUrgency(inHours(-5), 'CONFIRMED', now, t).level).toBe(
      'OVERDUE',
    );
  });

  it('uses the thresholds, boundaries included', () => {
    expect(computeUrgency(inHours(0), 'PENDING', now, t).level).toBe('URGENT');
    expect(computeUrgency(inHours(24), 'PENDING', now, t).level).toBe('URGENT');
    expect(computeUrgency(inHours(24.1), 'PENDING', now, t).level).toBe(
      'MEDIUM',
    );
    expect(computeUrgency(inHours(72), 'PENDING', now, t).level).toBe('MEDIUM');
    expect(computeUrgency(inHours(72.1), 'PENDING', now, t).level).toBe(
      'NOT_URGENT',
    );
  });

  it('ranks waiting-for-doctor above waiting-for-Dermee above fully confirmed', () => {
    const pending = computeUrgency(inHours(5), 'PENDING', now, t).priority;
    const awaitingDermee = computeUrgency(
      inHours(5),
      'CONFIRMED',
      now,
      t,
    ).priority;
    const confirmed = computeUrgency(
      inHours(5),
      'DERMEE_CONFIRMED',
      now,
      t,
    ).priority;
    expect(pending).toBeLessThan(awaitingDermee);
    expect(awaitingDermee).toBeLessThan(confirmed);
    // Any urgent unconfirmed beats a medium one.
    expect(awaitingDermee).toBeLessThan(
      computeUrgency(inHours(48), 'PENDING', now, t).priority,
    );
  });

  it('never treats finished reservations as urgent', () => {
    for (const s of [
      'COMPLETED',
      'CANCELLED',
      'REJECTED',
      'NO_SHOW',
    ] as const) {
      const u = computeUrgency(inHours(2), s, now, t);
      expect(u.level).toBeNull();
      expect(u.priority).toBe(9);
    }
  });

  it('asks for an outcome when a fully confirmed visit is in the past', () => {
    const u = computeUrgency(inHours(-2), 'DERMEE_CONFIRMED', now, t);
    expect(u.level).toBeNull();
    expect(u.needsOutcome).toBe(true);
  });

  it('follows configurable thresholds', () => {
    expect(
      computeUrgency(inHours(30), 'PENDING', now, {
        urgentHours: 48,
        mediumHours: 96,
      }).level,
    ).toBe('URGENT');
  });
});

describe('urgencyWhere', () => {
  it('selects overdue as awaiting-confirmation states before now', () => {
    expect(urgencyWhere('OVERDUE', now, t)).toEqual({
      state: { in: ['PENDING', 'CONFIRMED'] },
      startAt: { lt: now },
    });
  });
});

describe('reservation reference', () => {
  it('formats and parses', () => {
    expect(formatReservationRef(123)).toBe('RSV-000123');
    expect(parseReservationRef('RSV-000123')).toBe(123);
    expect(parseReservationRef('rsv123')).toBe(123);
    expect(parseReservationRef('42')).toBe(42);
    expect(parseReservationRef('Amina')).toBeNull();
  });
});
