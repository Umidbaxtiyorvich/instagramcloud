-- AlterTable
ALTER TABLE "MiyaSozlama" ADD COLUMN     "telegramChat" TEXT,
ADD COLUMN     "telegramKod" TEXT,
ADD COLUMN     "telegramKodVaqt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "MiyaSozlama_telegramChat_key" ON "MiyaSozlama"("telegramChat");

-- CreateIndex
CREATE UNIQUE INDEX "MiyaSozlama_telegramKod_key" ON "MiyaSozlama"("telegramKod");
