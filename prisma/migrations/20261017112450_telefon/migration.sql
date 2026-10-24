-- AlterTable
ALTER TABLE "MiyaSozlama" ADD COLUMN     "oxirgiQongiroq" TIMESTAMP(3),
ADD COLUMN     "qongiroqRejim" TEXT NOT NULL DEFAULT 'xavf',
ADD COLUMN     "telefon" TEXT,
ADD COLUMN     "telefonKod" TEXT,
ADD COLUMN     "telefonKodVaqt" TIMESTAMP(3),
ADD COLUMN     "telefonPin" TEXT,
ADD COLUMN     "telefonTasdiq" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "telefonUrinish" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "MiyaXabar" ADD COLUMN     "qongiroq" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Qongiroq" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "yonalish" TEXT NOT NULL,
    "kalit" TEXT NOT NULL,
    "sid" TEXT,
    "sabab" TEXT NOT NULL DEFAULT '',
    "holat" TEXT NOT NULL DEFAULT 'boshlandi',
    "suhbat" TEXT NOT NULL DEFAULT '[]',
    "kutish" BOOLEAN NOT NULL DEFAULT false,
    "tugat" BOOLEAN NOT NULL DEFAULT false,
    "pinOtdi" BOOLEAN NOT NULL DEFAULT false,
    "fikrId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tugadi" TIMESTAMP(3),

    CONSTRAINT "Qongiroq_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Qongiroq_userId_createdAt_idx" ON "Qongiroq"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Qongiroq_sid_idx" ON "Qongiroq"("sid");

-- AddForeignKey
ALTER TABLE "Qongiroq" ADD CONSTRAINT "Qongiroq_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- eski xabarlar uchun qo'ng'iroq qilinmasin
UPDATE "MiyaXabar" SET "qongiroq" = true;
