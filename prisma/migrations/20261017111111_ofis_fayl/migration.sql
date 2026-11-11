-- CreateTable
CREATE TABLE "OfisFayl" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "tur" TEXT NOT NULL,
    "hajm" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfisFayl_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfisFayl_userId_createdAt_idx" ON "OfisFayl"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "OfisFayl" ADD CONSTRAINT "OfisFayl_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
