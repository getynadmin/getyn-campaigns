-- Phase 9 — CheckoutOrder for XPay-driven subscription purchases
CREATE TYPE "CheckoutOrderStatus" AS ENUM ('DRAFT', 'PENDING', 'PAID', 'FAILED', 'CANCELED');

CREATE TABLE "CheckoutOrder" (
  "id" TEXT NOT NULL,
  "merchantReference" TEXT NOT NULL,
  "status" "CheckoutOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "planId" TEXT NOT NULL,
  "planSlug" TEXT NOT NULL,
  "planName" TEXT NOT NULL,
  "volumeMessages" INTEGER NOT NULL,
  "billingCycle" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "customerEmail" TEXT NOT NULL,
  "customerFirstName" TEXT,
  "customerLastName" TEXT,
  "xpaySubscriptionId" TEXT,
  "xpayFwdUrl" TEXT,
  "userId" TEXT,
  "tenantId" TEXT,
  "paidAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CheckoutOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckoutOrder_merchantReference_key" ON "CheckoutOrder"("merchantReference");
CREATE INDEX "CheckoutOrder_status_createdAt_idx" ON "CheckoutOrder"("status", "createdAt" DESC);
CREATE INDEX "CheckoutOrder_xpaySubscriptionId_idx" ON "CheckoutOrder"("xpaySubscriptionId");
CREATE INDEX "CheckoutOrder_customerEmail_idx" ON "CheckoutOrder"("customerEmail");

ALTER TABLE "CheckoutOrder"
  ADD CONSTRAINT "CheckoutOrder_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CheckoutOrder"
  ADD CONSTRAINT "CheckoutOrder_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CheckoutOrder"
  ADD CONSTRAINT "CheckoutOrder_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
