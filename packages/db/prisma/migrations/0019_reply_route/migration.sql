CREATE TABLE "ReplyRoute" (
  "id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "nodeId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReplyRoute_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReplyRoute_token_key" ON "ReplyRoute" ("token");
CREATE INDEX "ReplyRoute_expiresAt_idx" ON "ReplyRoute" ("expiresAt");
CREATE INDEX "ReplyRoute_tenantId_kind_targetId_idx" ON "ReplyRoute" ("tenantId", "kind", "targetId");
