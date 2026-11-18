-- Reservation lifecycle: Dermee confirmation, rejection, no-show, reference numbers,
-- status history and admin notes. Hand-ordered (Prisma's generated order alters the
-- history table before creating it, and numbers existing rows arbitrarily).

-- 1. SCHEDULED was never set by the code; anything still holding it means "confirmed".
--    Must happen before the type swap, which refuses rows with removed values.
UPDATE "Appointment" SET "state" = 'CONFIRMED' WHERE "state"::text = 'SCHEDULED';

-- 2. Remove SCHEDULED from the enum (Postgres can't drop enum values in place).
CREATE TYPE "AppointmentState_new" AS ENUM ('PENDING', 'CONFIRMED', 'DERMEE_CONFIRMED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'NO_SHOW');
ALTER TABLE "Appointment" ALTER COLUMN "state" DROP DEFAULT;
ALTER TABLE "Appointment" ALTER COLUMN "state" TYPE "AppointmentState_new" USING ("state"::text::"AppointmentState_new");
ALTER TYPE "AppointmentState" RENAME TO "AppointmentState_old";
ALTER TYPE "AppointmentState_new" RENAME TO "AppointmentState";
DROP TYPE "AppointmentState_old";
ALTER TABLE "Appointment" ALTER COLUMN "state" SET DEFAULT 'PENDING';

-- 3. New columns.
ALTER TABLE "Appointment" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "refNo" SERIAL NOT NULL,
ADD COLUMN     "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 4. Number existing reservations in creation order (RSV-000001 is the oldest),
--    then move the sequence past them. Done before the unique index exists.
UPDATE "Appointment" a
SET "refNo" = n.rn
FROM (SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn FROM "Appointment") n
WHERE a."id" = n."id";
SELECT setval(
  pg_get_serial_sequence('"Appointment"', 'refNo'),
  COALESCE((SELECT MAX("refNo") FROM "Appointment"), 0) + 1,
  false
);

-- Best available value for "last status update" on existing rows.
UPDATE "Appointment" SET "statusChangedAt" = "updatedAt";

-- 5. History and notes.
CREATE TABLE "AppointmentStatusHistory" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "fromState" "AppointmentState",
    "toState" "AppointmentState" NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentStatusHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppointmentAdminNote" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentAdminNote_pkey" PRIMARY KEY ("id")
);

-- 6. Indexes and keys.
CREATE INDEX "AppointmentStatusHistory_appointmentId_createdAt_idx" ON "AppointmentStatusHistory"("appointmentId", "createdAt");
CREATE INDEX "AppointmentAdminNote_appointmentId_createdAt_idx" ON "AppointmentAdminNote"("appointmentId", "createdAt");
CREATE UNIQUE INDEX "Appointment_refNo_key" ON "Appointment"("refNo");
CREATE INDEX "Appointment_state_startAt_idx" ON "Appointment"("state", "startAt");
CREATE INDEX "Appointment_doctorId_startAt_idx" ON "Appointment"("doctorId", "startAt");
CREATE INDEX "Appointment_patientId_idx" ON "Appointment"("patientId");
CREATE INDEX "Appointment_createdAt_idx" ON "Appointment"("createdAt");

ALTER TABLE "AppointmentStatusHistory" ADD CONSTRAINT "AppointmentStatusHistory_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentAdminNote" ADD CONSTRAINT "AppointmentAdminNote_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Start each existing reservation's history with its current state.
INSERT INTO "AppointmentStatusHistory" ("id", "appointmentId", "fromState", "toState", "actorId", "actorRole", "note", "createdAt")
SELECT 'mig_' || "id", "id", NULL, "state", NULL, 'SYSTEM', 'State at migration time', "updatedAt"
FROM "Appointment";
