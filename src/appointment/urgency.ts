import { AppointmentState, Prisma } from '@prisma/client';
import { HOUR_MS } from '../common/dates';
import {
  AWAITING_CONFIRMATION,
  BLOCKING_STATES,
  TERMINAL_STATES,
} from './appointment-state';

export type UrgencyLevel = 'OVERDUE' | 'URGENT' | 'MEDIUM' | 'NOT_URGENT';
export const URGENCY_LEVELS: UrgencyLevel[] = [
  'OVERDUE',
  'URGENT',
  'MEDIUM',
  'NOT_URGENT',
];

export interface UrgencyThresholds {
  urgentHours: number;
  mediumHours: number;
}

export interface Urgency {
  /** null for finished reservations: they are never "urgent". */
  level: UrgencyLevel | null;
  /** Still waiting for the doctor (PENDING) or for Dermee (CONFIRMED). */
  awaitingConfirmation: boolean;
  /** Visit time passed but nobody recorded COMPLETED / NO_SHOW. */
  needsOutcome: boolean;
  hoursUntilStart: number;
  /** Lower = handle first. Same order as the SQL used for `sort=priority`. */
  priority: number;
}

/**
 * Urgency from the appointment time and the confirmation state.
 * - OVERDUE: the visit time passed and it was never fully confirmed → immediate attention.
 * - URGENT / MEDIUM / NOT_URGENT: by hours until the visit (configurable thresholds).
 * - Unconfirmed reservations rank above confirmed ones at the same level.
 */
export function computeUrgency(
  startAt: Date,
  state: AppointmentState,
  now: Date,
  t: UrgencyThresholds,
): Urgency {
  const hoursUntilStart =
    Math.round(((startAt.getTime() - now.getTime()) / HOUR_MS) * 10) / 10;
  const awaitingConfirmation = AWAITING_CONFIRMATION.includes(state);

  if (TERMINAL_STATES.includes(state)) {
    return {
      level: null,
      awaitingConfirmation: false,
      needsOutcome: false,
      hoursUntilStart,
      priority: 9,
    };
  }
  if (hoursUntilStart < 0) {
    if (awaitingConfirmation) {
      return {
        level: 'OVERDUE',
        awaitingConfirmation,
        needsOutcome: false,
        hoursUntilStart,
        priority: 0,
      };
    }
    // Fully confirmed and in the past: someone has to record what happened.
    return {
      level: null,
      awaitingConfirmation,
      needsOutcome: true,
      hoursUntilStart,
      priority: 8,
    };
  }

  const level: UrgencyLevel =
    hoursUntilStart <= t.urgentHours
      ? 'URGENT'
      : hoursUntilStart <= t.mediumHours
        ? 'MEDIUM'
        : 'NOT_URGENT';
  return {
    level,
    awaitingConfirmation,
    needsOutcome: false,
    hoursUntilStart,
    priority: priorityOf(level, state),
  };
}

function priorityOf(
  level: Exclude<UrgencyLevel, 'OVERDUE'>,
  state: AppointmentState,
): number {
  if (state === 'DERMEE_CONFIRMED') return 7;
  const base = level === 'URGENT' ? 1 : level === 'MEDIUM' ? 3 : 5;
  return state === 'PENDING' ? base : base + 1;
}

/** Prisma filter selecting one urgency level (used by the reservations list). */
export function urgencyWhere(
  level: UrgencyLevel,
  now: Date,
  t: UrgencyThresholds,
): Prisma.AppointmentWhereInput {
  const urgentEnd = new Date(now.getTime() + t.urgentHours * HOUR_MS);
  const mediumEnd = new Date(now.getTime() + t.mediumHours * HOUR_MS);
  switch (level) {
    case 'OVERDUE':
      return { state: { in: AWAITING_CONFIRMATION }, startAt: { lt: now } };
    case 'URGENT':
      return {
        state: { in: BLOCKING_STATES },
        startAt: { gte: now, lte: urgentEnd },
      };
    case 'MEDIUM':
      return {
        state: { in: BLOCKING_STATES },
        startAt: { gt: urgentEnd, lte: mediumEnd },
      };
    case 'NOT_URGENT':
      return { state: { in: BLOCKING_STATES }, startAt: { gt: mediumEnd } };
  }
}

/** SQL twin of computeUrgency().priority for ORDER BY (alias `a` = "Appointment"). */
export function prioritySql(now: Date, t: UrgencyThresholds): Prisma.Sql {
  const urgentEnd = new Date(now.getTime() + t.urgentHours * HOUR_MS);
  const mediumEnd = new Date(now.getTime() + t.mediumHours * HOUR_MS);
  return Prisma.sql`CASE
    WHEN a."state"::text IN ('COMPLETED', 'CANCELLED', 'REJECTED', 'NO_SHOW') THEN 9
    WHEN a."startAt" < ${now} AND a."state"::text IN ('PENDING', 'CONFIRMED') THEN 0
    WHEN a."startAt" < ${now} THEN 8
    WHEN a."state"::text = 'DERMEE_CONFIRMED' THEN 7
    WHEN a."startAt" <= ${urgentEnd} THEN CASE WHEN a."state"::text = 'PENDING' THEN 1 ELSE 2 END
    WHEN a."startAt" <= ${mediumEnd} THEN CASE WHEN a."state"::text = 'PENDING' THEN 3 ELSE 4 END
    ELSE CASE WHEN a."state"::text = 'PENDING' THEN 5 ELSE 6 END
  END`;
}

export function formatReservationRef(refNo: number): string {
  return `RSV-${String(refNo).padStart(6, '0')}`;
}

/** Accepts "RSV-000123", "rsv123" or "123". */
export function parseReservationRef(text: string): number | null {
  const m = /^(?:rsv-?)?0*(\d{1,9})$/i.exec(text.trim());
  return m ? Number(m[1]) : null;
}
