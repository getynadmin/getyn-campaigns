-- CreateTable
CREATE TABLE "TenantUserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "onboardingDismissed" BOOLEAN NOT NULL DEFAULT false,
    "onboardingCollapsed" BOOLEAN NOT NULL DEFAULT false,
    "onboardingSkipped" JSONB NOT NULL DEFAULT '[]',
    "dashboardLayout" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantUserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantUserPreference_userId_tenantId_key" ON "TenantUserPreference"("userId", "tenantId");
CREATE INDEX "TenantUserPreference_tenantId_idx" ON "TenantUserPreference"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantUserPreference" ADD CONSTRAINT "TenantUserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantUserPreference" ADD CONSTRAINT "TenantUserPreference_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
