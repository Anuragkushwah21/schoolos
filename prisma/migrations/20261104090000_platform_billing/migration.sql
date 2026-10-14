-- CreateTable
CREATE TABLE "PlatformBill" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billNo" TEXT NOT NULL,
    "planName" TEXT,
    "description" TEXT,
    "periodStart" DATE,
    "periodEnd" DATE,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "dueOn" DATE NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformPayment" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "receivedOn" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "referenceNo" TEXT,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformBill_billNo_key" ON "PlatformBill"("billNo");

-- CreateIndex
CREATE INDEX "PlatformBill_organizationId_dueOn_idx" ON "PlatformBill"("organizationId", "dueOn");

-- CreateIndex
CREATE INDEX "PlatformBill_dueOn_idx" ON "PlatformBill"("dueOn");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPayment_idempotencyKey_key" ON "PlatformPayment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PlatformPayment_billId_idx" ON "PlatformPayment"("billId");

-- CreateIndex
CREATE INDEX "PlatformPayment_receivedOn_idx" ON "PlatformPayment"("receivedOn");

-- AddForeignKey
ALTER TABLE "PlatformBill" ADD CONSTRAINT "PlatformBill_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPayment" ADD CONSTRAINT "PlatformPayment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "PlatformBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

