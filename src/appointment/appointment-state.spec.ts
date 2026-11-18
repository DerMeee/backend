import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  allowedTransitions,
  assertTransition,
  transitionError,
  type ActorRole,
  type TransitionName,
} from './appointment-state';

const now = new Date('2026-11-02T10:00:00Z');
const future = new Date('2026-11-03T10:00:00Z');
const past = new Date('2026-11-01T10:00:00Z');

describe('appointment state machine', () => {
  // [transition, from, role, startAt, expected target or error kind]
  const cases: Array<[TransitionName, string, ActorRole, Date, string]> = [
    ['doctorConfirm', 'PENDING', 'DOCTOR', future, 'CONFIRMED'],
    ['doctorConfirm', 'PENDING', 'ADMIN', future, 'forbidden'],
    ['doctorConfirm', 'PENDING', 'PATIENT', future, 'forbidden'],
    ['doctorConfirm', 'CONFIRMED', 'DOCTOR', future, 'invalid'],
    ['doctorConfirm', 'PENDING', 'DOCTOR', past, 'invalid'],

    // Dermee confirms only after the doctor did.
    ['dermeeConfirm', 'CONFIRMED', 'ADMIN', future, 'DERMEE_CONFIRMED'],
    ['dermeeConfirm', 'PENDING', 'ADMIN', future, 'invalid'],
    ['dermeeConfirm', 'CONFIRMED', 'DOCTOR', future, 'forbidden'],
    ['dermeeConfirm', 'CONFIRMED', 'ADMIN', past, 'invalid'],

    ['reject', 'PENDING', 'DOCTOR', future, 'REJECTED'],
    ['reject', 'CONFIRMED', 'DOCTOR', future, 'invalid'],
    ['reject', 'PENDING', 'ADMIN', future, 'forbidden'],

    // Outcomes only after the visit time.
    ['complete', 'DERMEE_CONFIRMED', 'DOCTOR', past, 'COMPLETED'],
    ['complete', 'CONFIRMED', 'ADMIN', past, 'COMPLETED'],
    ['complete', 'DERMEE_CONFIRMED', 'DOCTOR', future, 'invalid'],
    ['complete', 'PENDING', 'ADMIN', past, 'invalid'],
    ['noShow', 'DERMEE_CONFIRMED', 'ADMIN', past, 'NO_SHOW'],
    ['noShow', 'DERMEE_CONFIRMED', 'PATIENT', past, 'forbidden'],

    ['cancel', 'PENDING', 'PATIENT', future, 'CANCELLED'],
    ['cancel', 'DERMEE_CONFIRMED', 'DOCTOR', future, 'CANCELLED'],
    ['cancel', 'CONFIRMED', 'PATIENT', past, 'invalid'],
    ['cancel', 'CONFIRMED', 'ADMIN', past, 'CANCELLED'],
    ['cancel', 'COMPLETED', 'ADMIN', past, 'invalid'],
    ['cancel', 'CANCELLED', 'PATIENT', future, 'invalid'],
  ];

  it.each(cases)(
    '%s from %s by %s → %s',
    (name, from, role, startAt, expected) => {
      const err = transitionError(
        name,
        from as never,
        role,
        startAt,
        now,
        'some reason',
      );
      if (expected === 'forbidden' || expected === 'invalid') {
        expect(err?.kind).toBe(expected);
      } else {
        expect(err).toBeNull();
        expect(
          assertTransition(
            name,
            from as never,
            role,
            startAt,
            now,
            'some reason',
          ),
        ).toBe(expected);
      }
    },
  );

  it('requires a reason when a doctor rejects or an admin cancels', () => {
    expect(() =>
      assertTransition('reject', 'PENDING', 'DOCTOR', future, now, '  '),
    ).toThrow(BadRequestException);
    expect(() =>
      assertTransition('cancel', 'CONFIRMED', 'ADMIN', future, now),
    ).toThrow(BadRequestException);
    // A patient may cancel without explaining.
    expect(assertTransition('cancel', 'PENDING', 'PATIENT', future, now)).toBe(
      'CANCELLED',
    );
  });

  it('throws Forbidden for a role that can never do the action', () => {
    expect(() =>
      assertTransition('dermeeConfirm', 'CONFIRMED', 'PATIENT', future, now),
    ).toThrow(ForbiddenException);
  });

  it('lists only the actions available now', () => {
    expect(
      allowedTransitions('CONFIRMED', 'ADMIN', future, now).sort(),
    ).toEqual(['cancel', 'dermeeConfirm']);
    expect(
      allowedTransitions('DERMEE_CONFIRMED', 'ADMIN', past, now).sort(),
    ).toEqual(['cancel', 'complete', 'noShow']);
    expect(allowedTransitions('COMPLETED', 'ADMIN', past, now)).toEqual([]);
    expect(allowedTransitions('PENDING', 'DOCTOR', future, now).sort()).toEqual(
      ['cancel', 'doctorConfirm', 'reject'],
    );
  });
});
