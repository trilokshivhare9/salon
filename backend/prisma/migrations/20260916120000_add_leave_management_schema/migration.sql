-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('SICK_LEAVE', 'CASUAL_LEAVE', 'EMERGENCY_LEAVE', 'UNPAID_LEAVE', 'OTHER');

-- CreateEnum
CREATE TYPE "LeavePortion" AS ENUM ('FULL_DAY', 'FIRST_HALF', 'SECOND_HALF', 'CUSTOM_HOURS');

-- CreateEnum
CREATE TYPE "LeaveProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- DropIndex
DROP INDEX IF EXISTS "stylist_absences_salon_id_absence_date_idx";

-- DropIndex
DROP INDEX IF EXISTS "stylist_absences_salon_id_stylist_id_absence_date_key";

-- DropIndex
DROP INDEX IF EXISTS "stylist_absences_stylist_id_absence_date_idx";

-- AlterTable
ALTER TABLE "stylist_absences" ADD COLUMN     "custom_end_time" TEXT,
ADD COLUMN     "custom_start_time" TEXT,
ADD COLUMN     "end_date" DATE NOT NULL,
ADD COLUMN     "leave_portion" "LeavePortion" NOT NULL DEFAULT 'FULL_DAY',
ADD COLUMN     "leave_type" "LeaveType" NOT NULL DEFAULT 'SICK_LEAVE',
ADD COLUMN     "processing_status" "LeaveProcessingStatus" NOT NULL DEFAULT 'COMPLETED',
ADD COLUMN     "start_date" DATE NOT NULL,
ALTER COLUMN "absence_date" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "stylist_absences_salon_id_start_date_end_date_idx" ON "stylist_absences"("salon_id", "start_date", "end_date");

-- CreateIndex
CREATE INDEX "stylist_absences_stylist_id_start_date_end_date_idx" ON "stylist_absences"("stylist_id", "start_date", "end_date");
