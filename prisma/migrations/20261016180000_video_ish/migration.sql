-- CreateTable
CREATE TABLE "VideoIsh" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spec" TEXT NOT NULL,
    "maqsad" TEXT NOT NULL,
    "meta" TEXT NOT NULL DEFAULT '{}',
    "holat" TEXT NOT NULL DEFAULT 'kutmoqda',
    "uploadId" TEXT,
    "xato" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoIsh_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoIsh_holat_createdAt_idx" ON "VideoIsh"("holat", "createdAt");

-- AddForeignKey
ALTER TABLE "VideoIsh" ADD CONSTRAINT "VideoIsh_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

