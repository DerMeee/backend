import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AppointmentState } from '@prisma/client';

/**
 * Reservation lifecycle — the single source of truth for who may move a reservation where.
 *
 *   PENDING ──doctor confirms──▶ CONFIRMED ──Dermee confirms──▶ DERMEE_CONFIRMED
 *      │                            │                                 │
 *      ├─doctor rejects─▶ REJECTED  └──────────────┬──────────────────┘
 *      │                                           ▼ after the start time
 *      └──────cancel (patient / doctor / admin)    COMPLETED | NO_SHOW
 *                         ▼
 *                     CANCELLED
 *
 * Ownership (is this *my* reservation?) is checked by the services; this file only knows roles.
 */

export type ActorRole = 'PATIENT' | 'DOCTOR' | 'ADMIN' | 'SYSTEM';

/** States that occupy the doctor's time slot. */
export const BLOCKING_STATES: AppointmentState[] = [
  'PENDING',
  'CONFIRMED',
  'DERMEE_CONFIRMED',
];

/** Still waiting for someone to confirm (the doctor, then Dermee). */
export const AWAITING_CONFIRMATION: AppointmentState[] = [
  'PENDING',
  'CONFIRMED',
];

export const TERMINAL_STATES: AppointmentState[] = [
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'NO_SHOW',
];

/** Labels for status badges. */
export const STATE_LABELS: Record<AppointmentState, string> = {
  PENDING: 'Pending doctor confirmation',
  CONFIRMED: 'Confirmed by doctor',
  DERMEE_CONFIRMED: 'Confirmed by Dermee',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
  NO_SHOW: 'No-show',
};

type Timing = 'beforeStart' | 'afterStart' | 'any';

interface Rule {
  from: AppointmentState[];
  to: AppointmentState;
  /** Allowed roles, each with when (relative to the start time) they may do it. */
  roles: Partial<Record<ActorRole, Timing>>;
  /** A reason is mandatory for these roles. */
  reasonRequiredFor?: ActorRole[];
  label: string;
}

export const TRANSITIONS = {
  doctorConfirm: {
    from: ['PENDING'],
    to: 'CONFIRMED',
    roles: { DOCTOR: 'beforeStart' },
    label: 'confirm',
  },
  reject: {
    from: ['PENDING'],
    to: 'REJECTED',
    roles: { DOCTOR: 'any' },
    reasonRequiredFor: ['DOCTOR'],
    label: 'reject',
  },
  dermeeConfirm: {
    from: ['CONFIRMED'],
    to: 'DERMEE_CONFIRMED',
    roles: { ADMIN: 'beforeStart' },
    label: 'confirm on behalf of Dermee',
  },
  complete: {
    from: ['CONFIRMED', 'DERMEE_CONFIRMED'],
    to: 'COMPLETED',
    roles: { DOCTOR: 'afterStart', ADMIN: 'afterStart' },
    label: 'mark as completed',
  },
  noShow: {
    from: ['CONFIRMED', 'DERMEE_CONFIRMED'],
    to: 'NO_SHOW',
    roles: { DOCTOR: 'afterStart', ADMIN: 'afterStart' },
    label: 'mark as no-show',
  },
  cancel: {
    from: ['PENDING', 'CONFIRMED', 'DERMEE_CONFIRMED'],
    to: 'CANCELLED',
    roles: { PATIENT: 'beforeStart', DOCTOR: 'beforeStart', ADMIN: 'any' },
    reasonRequiredFor: ['ADMIN'],
    label: 'cancel',
  },
} satisfies Record<string, Rule>;

export type TransitionName = keyof typeof TRANSITIONS;

export function targetState(name: TransitionName): AppointmentState {
  return TRANSITIONS[name].to as AppointmentState;
}

/** Why a transition is not allowed, or null when it is. Pure: easy to unit test. */
export function transitionError(
  name: TransitionName,
  from: AppointmentState,
  role: ActorRole,
  startAt: Date,
  now: Date,
  reason?: string | null,
): { kind: 'forbidden' | 'invalid'; message: string } | null {
  const rule: Rule = TRANSITIONS[name];
  const timing = rule.roles[role];
  if (!timing) {
    return {
      kind: 'forbidden',
      message: `A ${role.toLowerCase()} cannot ${rule.label} a reservation`,
    };
  }
  if (!rule.from.includes(from)) {
    return {
      kind: 'invalid',
      message: `Cannot ${rule.label} a reservation that is ${from}`,
    };
  }
  const started = startAt.getTime() <= now.getTime();
  if (timing === 'beforeStart' && started) {
    return {
      kind: 'invalid',
      message: `Too late to ${rule.label}: the appointment time has passed`,
    };
  }
  if (timing === 'afterStart' && !started) {
    return {
      kind: 'invalid',
      message: `Cannot ${rule.label} before the appointment time`,
    };
  }
  if (rule.reasonRequiredFor?.includes(role) && !reason?.trim()) {
    return {
      kind: 'invalid',
      message: `A reason is required to ${rule.label}`,
    };
  }
  return null;
}

export function assertTransition(
  name: TransitionName,
  from: AppointmentState,
  role: ActorRole,
  startAt: Date,
  now: Date,
  reason?: string | null,
): AppointmentState {
  const err = transitionError(name, from, role, startAt, now, reason);
  if (err) {
    throw err.kind === 'forbidden'
      ? new ForbiddenException(err.message)
      : new BadRequestException(err.message);
  }
  return targetState(name);
}

/** Transitions this role could do right now (to show only valid buttons in the UI). */
export function allowedTransitions(
  from: AppointmentState,
  role: ActorRole,
  startAt: Date,
  now: Date,
): TransitionName[] {
  return (Object.keys(TRANSITIONS) as TransitionName[]).filter(
    // Pass a placeholder reason: required reasons are collected by the UI, not a blocker here.
    (name) => transitionError(name, from, role, startAt, now, 'x') === null,
  );
}
