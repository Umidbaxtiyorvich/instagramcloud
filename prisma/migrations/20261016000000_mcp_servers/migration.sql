-- CreateTable
CREATE TABLE "McpServer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "auth" TEXT NOT NULL DEFAULT 'none',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowWrites" BOOLEAN NOT NULL DEFAULT false,
    "toolsJson" TEXT,
    "checkedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "oauthClientId" TEXT,
    "oauthClientSecretEnc" TEXT,
    "oauthTokenUrl" TEXT,
    "oauthAuthUrl" TEXT,
    "oauthScope" TEXT,
    "oauthVerifierEnc" TEXT,
    "oauthState" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpServer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpServer_oauthState_key" ON "McpServer"("oauthState");

-- CreateIndex
CREATE UNIQUE INDEX "McpServer_userId_name_key" ON "McpServer"("userId", "name");

-- AddForeignKey
ALTER TABLE "McpServer" ADD CONSTRAINT "McpServer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

