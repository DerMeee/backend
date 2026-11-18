-- New reservation states. Kept in their own migration: Postgres cannot use an enum
-- value in the same transaction that added it, and the next migration uses them.
ALTER TYPE "AppointmentState" ADD VALUE IF NOT EXISTS 'DERMEE_CONFIRMED';
ALTER TYPE "AppointmentState" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "AppointmentState" ADD VALUE IF NOT EXISTS 'NO_SHOW';
