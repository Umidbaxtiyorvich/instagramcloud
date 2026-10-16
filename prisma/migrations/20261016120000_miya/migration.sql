-- CreateTable
CREATE TABLE "MiyaSozlama" (
    "userId" TEXT NOT NULL,
    "autoReels" BOOLEAN NOT NULL DEFAULT true,
    "reelsVaqtlari" TEXT NOT NULL DEFAULT '10:00,19:00',
    "reelsBrend" TEXT NOT NULL DEFAULT '',
    "reelsFooter" TEXT NOT NULL DEFAULT '',
    "kamQoldiq" INTEGER NOT NULL DEFAULT 5,
    "qarzKunlari" INTEGER NOT NULL DEFAULT 30,
    "oxirgiMoliya" TIMESTAMP(3),
    "oxirgiInstagram" TIMESTAMP(3),
    "oxirgiQarz" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MiyaSozlama_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "MiyaXabar" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tur" TEXT NOT NULL,
    "daraja" TEXT NOT NULL DEFAULT 'info',
    "matn" TEXT NOT NULL,
    "kalit" TEXT NOT NULL,
    "oqildi" BOOLEAN NOT NULL DEFAULT false,
    "telegram" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MiyaXabar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RejaPost" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tur" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "vaqt" TIMESTAMP(3) NOT NULL,
    "holat" TEXT NOT NULL DEFAULT 'kutmoqda',
    "xato" TEXT,
    "manba" TEXT NOT NULL DEFAULT 'men',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RejaPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Xotira" (
    "userId" TEXT NOT NULL,
    "profil" TEXT NOT NULL,
    "manba" TEXT NOT NULL DEFAULT 'chatgpt',
    "yangilandi" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Xotira_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "MiyaXabar_userId_createdAt_idx" ON "MiyaXabar"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MiyaXabar_userId_kalit_key" ON "MiyaXabar"("userId", "kalit");

-- CreateIndex
CREATE INDEX "RejaPost_holat_vaqt_idx" ON "RejaPost"("holat", "vaqt");

-- AddForeignKey
ALTER TABLE "MiyaSozlama" ADD CONSTRAINT "MiyaSozlama_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MiyaXabar" ADD CONSTRAINT "MiyaXabar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RejaPost" ADD CONSTRAINT "RejaPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Xotira" ADD CONSTRAINT "Xotira_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

