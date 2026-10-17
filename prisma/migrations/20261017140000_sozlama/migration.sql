-- CreateTable
CREATE TABLE "Sozlama" (
    "kalit" TEXT NOT NULL,
    "qiymat" TEXT NOT NULL,
    "yangilandi" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sozlama_pkey" PRIMARY KEY ("kalit")
);
