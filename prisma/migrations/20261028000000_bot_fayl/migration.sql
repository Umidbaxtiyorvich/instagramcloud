-- CreateTable
CREATE TABLE "BotFayl" (
    "yol" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotFayl_pkey" PRIMARY KEY ("yol")
);
