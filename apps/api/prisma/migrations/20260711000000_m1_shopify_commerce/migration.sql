-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'FULFILLED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "FinancialStatus" AS ENUM ('PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CommerceEventType" AS ENUM ('CHECKOUT_STARTED', 'ADD_TO_CART', 'ORDER_PLACED');

-- AlterEnum
ALTER TYPE "IntegrationStatus" ADD VALUE 'PAUSED';

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN     "lastSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "customerId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "financialStatus" "FinancialStatus" NOT NULL DEFAULT 'PENDING',
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "discountCode" TEXT,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "placedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "title" TEXT NOT NULL,
    "variant" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "priceMinor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cart" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "customerId" TEXT,
    "checkoutStartedAt" TIMESTAMP(3) NOT NULL,
    "convertedOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "productId" TEXT,
    "title" TEXT NOT NULL,
    "variant" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "priceMinor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT,
    "type" "CommerceEventType" NOT NULL,
    "externalId" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Customer_organizationId_phone_idx" ON "Customer"("organizationId", "phone");

-- CreateIndex
CREATE INDEX "Customer_organizationId_mergedIntoId_idx" ON "Customer"("organizationId", "mergedIntoId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_organizationId_externalId_key" ON "Customer"("organizationId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_organizationId_email_key" ON "Customer"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Product_organizationId_externalId_key" ON "Product"("organizationId", "externalId");

-- CreateIndex
CREATE INDEX "Order_organizationId_customerId_idx" ON "Order"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "Order_organizationId_placedAt_idx" ON "Order"("organizationId", "placedAt");

-- CreateIndex
CREATE INDEX "Order_organizationId_financialStatus_idx" ON "Order"("organizationId", "financialStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Order_organizationId_externalId_key" ON "Order"("organizationId", "externalId");

-- CreateIndex
CREATE INDEX "OrderItem_organizationId_orderId_idx" ON "OrderItem"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "Cart_organizationId_customerId_idx" ON "Cart"("organizationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Cart_organizationId_externalId_key" ON "Cart"("organizationId", "externalId");

-- CreateIndex
CREATE INDEX "CartItem_organizationId_cartId_idx" ON "CartItem"("organizationId", "cartId");

-- CreateIndex
CREATE INDEX "CommerceEvent_organizationId_customerId_occurredAt_idx" ON "CommerceEvent"("organizationId", "customerId", "occurredAt");

-- CreateIndex
CREATE INDEX "CommerceEvent_organizationId_type_occurredAt_idx" ON "CommerceEvent"("organizationId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_organizationId_provider_createdAt_idx" ON "WebhookDelivery"("organizationId", "provider", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_organizationId_provider_eventId_key" ON "WebhookDelivery"("organizationId", "provider", "eventId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceEvent" ADD CONSTRAINT "CommerceEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

