-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DoctorApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AccountStatusField" AS ENUM ('APPROVAL', 'STATUS');

-- CreateEnum
CREATE TYPE "DoctorDocumentType" AS ENUM ('MEDICAL_LICENSE', 'DIPLOMA', 'ID_CARD', 'OTHER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3),
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "suspendReason" TEXT,
ADD COLUMN     "suspendedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Doctor" ADD COLUMN     "approvalStatus" "DoctorApprovalStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "specialty" TEXT;

-- AlterTable
ALTER TABLE "PatientDocument" ADD COLUMN     "storageKey" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "entityType" TEXT,
ADD COLUMN     "link" TEXT,
ADD COLUMN     "readAt" TIMESTAMP(3),
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'GENERAL';

-- CreateTable
CREATE TABLE "DoctorDocument" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "documentType" "DoctorDocumentType" NOT NULL DEFAULT 'OTHER',
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoctorDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountStatusHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "field" "AccountStatusField" NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DoctorDocument_doctorId_idx" ON "DoctorDocument"("doctorId");

-- CreateIndex
CREATE INDEX "AccountStatusHistory_userId_createdAt_idx" ON "AccountStatusHistory"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "User_role_createdAt_idx" ON "User"("role", "createdAt");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_phoneNumber_idx" ON "User"("phoneNumber");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "Address_state_city_idx" ON "Address"("state", "city");

-- CreateIndex
CREATE INDEX "Doctor_approvalStatus_idx" ON "Doctor"("approvalStatus");

-- CreateIndex
CREATE INDEX "Notification_userId_read_createdAt_idx" ON "Notification"("userId", "read", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "DoctorDocument" ADD CONSTRAINT "DoctorDocument_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountStatusHistory" ADD CONSTRAINT "AccountStatusHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Data backfill
-- ---------------------------------------------------------------------------

-- Doctors that existed before the approval workflow stay visible and bookable.
UPDATE "Doctor" SET "approvalStatus" = 'APPROVED', "approvedAt" = "createdAt";

-- Split the display name: first word → firstName, the rest → lastName.
UPDATE "User"
SET "firstName" = NULLIF(split_part(btrim("name"), ' ', 1), ''),
    "lastName"  = NULLIF(btrim(substr(btrim("name"), length(split_part(btrim("name"), ' ', 1)) + 1)), '')
WHERE "firstName" IS NULL;

-- Patient documents move to private storage. The key is the path under the storage
-- root ("patient-files/<patientId>/<file>"), and the URL becomes the authenticated
-- download endpoint. The API still finds files left in the old public folder until
-- they are moved (see src/cli/move-patient-files.ts).
UPDATE "PatientDocument"
SET "storageKey" = regexp_replace("fileUrl", '^/uploads/', ''),
    "fileUrl"    = '/files/patient-documents/' || "id"
WHERE "storageKey" IS NULL AND "fileUrl" LIKE '/uploads/%';
