-- AlterEnum
ALTER TYPE "BookingSource" ADD VALUE 'QUICK_BOOK';

-- AlterEnum
ALTER TYPE "ConversationState" ADD VALUE 'QUICK_BOOK_CODE';
ALTER TYPE "ConversationState" ADD VALUE 'QUICK_BOOK_CONFIRM';

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "quick_code_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "quick_code_locked_until" TIMESTAMPTZ,
ADD COLUMN     "quick_code_verified_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "salon_quick_codes" (
    "id" TEXT NOT NULL,
    "salon_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "valid_date" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salon_quick_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "salon_quick_codes_salon_id_key" ON "salon_quick_codes"("salon_id");

-- CreateIndex
CREATE INDEX "salon_quick_codes_salon_id_valid_date_idx" ON "salon_quick_codes"("salon_id", "valid_date");

-- AddForeignKey
ALTER TABLE "salon_quick_codes" ADD CONSTRAINT "salon_quick_codes_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
