-- Catch-up for changes previously applied with `prisma db push`.
-- Kept on its own: Postgres cannot use a new enum value in the same transaction that adds it.
ALTER TYPE "AppointmentState" ADD VALUE IF NOT EXISTS 'PENDING';
