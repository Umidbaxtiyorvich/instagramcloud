-- AlterTable
ALTER TABLE "MiyaSozlama" ADD COLUMN     "mustaqillik" TEXT NOT NULL DEFAULT 'ishonchli',
ADD COLUMN     "oxirgiFikr" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MiyaFikr" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amal" TEXT NOT NULL,
    "sarlavha" TEXT NOT NULL,
    "fikr" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "ishonch" INTEGER NOT NULL,
    "xavf" TEXT NOT NULL,
    "holat" TEXT NOT NULL DEFAULT 'kutmoqda',
    "natija" TEXT,
    "izoh" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hal" TIMESTAMP(3),

    CONSTRAINT "MiyaFikr_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MiyaFikr_userId_holat_idx" ON "MiyaFikr"("userId", "holat");

-- CreateIndex
CREATE INDEX "MiyaFikr_userId_createdAt_idx" ON "MiyaFikr"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "MiyaFikr" ADD CONSTRAINT "MiyaFikr_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
