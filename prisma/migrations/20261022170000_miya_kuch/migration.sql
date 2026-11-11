-- AlterTable
ALTER TABLE "MiyaSozlama" ADD COLUMN "qoidalar" TEXT NOT NULL DEFAULT '',
ADD COLUMN "oxirgiHisobot" TIMESTAMP(3),
ADD COLUMN "oxirgiObunachi" INTEGER;

-- CreateTable
CREATE TABLE "MiyaReels" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "joylandi" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "korish" INTEGER,
    "nisbat" DOUBLE PRECISION,
    "tekshirildi" TIMESTAMP(3),

    CONSTRAINT "MiyaReels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MiyaReels_tekshirildi_joylandi_idx" ON "MiyaReels"("tekshirildi", "joylandi");

-- CreateIndex
CREATE UNIQUE INDEX "MiyaReels_userId_mediaId_key" ON "MiyaReels"("userId", "mediaId");

-- AddForeignKey
ALTER TABLE "MiyaReels" ADD CONSTRAINT "MiyaReels_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
