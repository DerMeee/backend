-- Marketplace: product images/ratings (from feature/product-apis), stock and inventory
-- history, publish status, and orders with independent order / payment / delivery
-- statuses. Hand-ordered so existing data is carried over before old columns go.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');
CREATE TYPE "DeliveryStatus" AS ENUM ('NOT_SHIPPED', 'SENT_TO_DELIVERY', 'DELIVERED');
CREATE TYPE "OrderStatusField" AS ENUM ('STATUS', 'PAYMENT', 'DELIVERY');
CREATE TYPE "ProductStatus" AS ENUM ('PUBLISHED', 'UNPUBLISHED', 'ARCHIVED');
CREATE TYPE "StockMovementReason" AS ENUM ('INITIAL', 'ADJUSTMENT', 'ORDER_PLACED', 'ORDER_RELEASED', 'RETURN');

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- Keep the single image of existing products as their primary image.
INSERT INTO "ProductImage" ("id", "productId", "url", "isPrimary", "order")
SELECT 'mig_' || "id", "id", "imageUrl", true, 0
FROM "Product"
WHERE "imageUrl" IS NOT NULL AND "imageUrl" <> '';

ALTER TABLE "Product" DROP COLUMN "imageUrl",
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "lowStockThreshold" INTEGER,
ADD COLUMN     "sku" TEXT,
ADD COLUMN     "status" "ProductStatus" NOT NULL DEFAULT 'UNPUBLISHED',
ADD COLUMN     "stock" INTEGER NOT NULL DEFAULT 0;

-- Products existing before this release were visible in the shop: keep them published.
-- Their stock starts at 0, so admins must set quantities before they can be ordered.
UPDATE "Product" SET "status" = 'PUBLISHED';

-- Stock can never go negative, whatever code path writes it.
-- (Not modelled by Prisma: `migrate diff` ignores CHECK constraints, so it is kept.)
ALTER TABLE "Product" ADD CONSTRAINT "Product_stock_non_negative" CHECK ("stock" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_lowStockThreshold_non_negative"
  CHECK ("lowStockThreshold" IS NULL OR "lowStockThreshold" >= 0);

CREATE TABLE "ProductRating" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "review" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductRating_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "stockAfter" INTEGER NOT NULL,
    "reason" "StockMovementReason" NOT NULL,
    "actorId" TEXT,
    "orderId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Wishlist" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ---------------------------------------------------------------------------
-- Orders: one `state` becomes three independent statuses
-- ---------------------------------------------------------------------------
ALTER TABLE "Order" ADD COLUMN     "addressLine" TEXT,
ADD COLUMN     "closeReason" TEXT,
ADD COLUMN     "commune" TEXT,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveryCompany" TEXT,
ADD COLUMN     "deliveryNote" TEXT,
ADD COLUMN     "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'NOT_SHIPPED',
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "recipientName" TEXT,
ADD COLUMN     "recipientPhone" TEXT,
ADD COLUMN     "refNo" SERIAL NOT NULL,
ADD COLUMN     "shippedAt" TIMESTAMP(3),
ADD COLUMN     "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "trackingNumber" TEXT,
ADD COLUMN     "wilaya" TEXT;

-- Old single state → new triple.
UPDATE "Order" SET
  "status" = CASE "state"::text
    WHEN 'PENDING' THEN 'PENDING'
    WHEN 'CANCELLED' THEN 'CANCELLED'
    ELSE 'CONFIRMED'
  END::"OrderStatus",
  "paymentStatus" = CASE
    WHEN "state"::text IN ('PAID', 'DELIVERED') THEN 'PAID'
    ELSE 'PENDING'
  END::"PaymentStatus",
  "deliveryStatus" = CASE "state"::text
    WHEN 'SHIPPED' THEN 'SENT_TO_DELIVERY'
    WHEN 'DELIVERED' THEN 'DELIVERED'
    ELSE 'NOT_SHIPPED'
  END::"DeliveryStatus";

-- Order totals from their items.
UPDATE "Order" o
SET "totalAmount" = COALESCE(t.total, 0)
FROM (SELECT "orderId", SUM("unitPrice" * "quantity") AS total FROM "OrderItem" GROUP BY "orderId") t
WHERE t."orderId" = o."id";

-- Delivery address: best effort from the customer's saved profile address.
UPDATE "Order" o
SET "recipientName" = u."name",
    "recipientPhone" = u."phoneNumber",
    "wilaya" = a."state",
    "commune" = a."city",
    "addressLine" = a."street"
FROM "Patient" p
JOIN "User" u ON u."id" = p."userId"
LEFT JOIN "Address" a ON a."id" = u."addressId"
WHERE p."id" = o."patientId";

-- Number existing orders by creation date (ORD-000001 = oldest).
UPDATE "Order" o
SET "refNo" = n.rn
FROM (SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn FROM "Order") n
WHERE o."id" = n."id";
SELECT setval(
  pg_get_serial_sequence('"Order"', 'refNo'),
  COALESCE((SELECT MAX("refNo") FROM "Order"), 0) + 1,
  false
);

ALTER TABLE "Order" DROP COLUMN "state";
DROP TYPE "OrderState";

CREATE TABLE "OrderStatusHistory" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "field" "OrderStatusField" NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

INSERT INTO "OrderStatusHistory" ("id", "orderId", "field", "fromValue", "toValue", "actorRole", "note", "createdAt")
SELECT 'mig_' || "id", "id", 'STATUS', NULL, "status"::text, 'SYSTEM', 'State at migration time', "updatedAt"
FROM "Order";

-- ---------------------------------------------------------------------------
-- Indexes and keys
-- ---------------------------------------------------------------------------
CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");
CREATE INDEX "StockMovement_orderId_idx" ON "StockMovement"("orderId");
CREATE UNIQUE INDEX "ProductRating_productId_patientId_key" ON "ProductRating"("productId", "patientId");
CREATE INDEX "OrderStatusHistory_orderId_createdAt_idx" ON "OrderStatusHistory"("orderId", "createdAt");
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE INDEX "Product_status_createdAt_idx" ON "Product"("status", "createdAt");
CREATE INDEX "Product_category_idx" ON "Product"("category");
CREATE UNIQUE INDEX "Order_refNo_key" ON "Order"("refNo");
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE INDEX "Order_paymentStatus_idx" ON "Order"("paymentStatus");
CREATE INDEX "Order_deliveryStatus_idx" ON "Order"("deliveryStatus");
CREATE INDEX "Order_patientId_createdAt_idx" ON "Order"("patientId", "createdAt");
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");
CREATE INDEX "Order_wilaya_commune_idx" ON "Order"("wilaya", "commune");
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductRating" ADD CONSTRAINT "ProductRating_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductRating" ADD CONSTRAINT "ProductRating_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
