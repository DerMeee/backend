import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Notification, Prisma, StockMovementReason } from '@prisma/client';
import { SettingsService } from '../settings/settings.service';
import {
  NotificationsService,
  NotificationType,
} from '../notifications/notifications.service';

export interface StockChange {
  productId: string;
  delta: number;
  reason: StockMovementReason;
  actorId?: string | null;
  orderId?: string | null;
  note?: string | null;
}

export interface StockResult {
  productId: string;
  stockBefore: number;
  stockAfter: number;
}

/**
 * All stock changes go through here. The update is a single conditional statement
 * (`stock + delta >= 0`), so concurrent orders can never oversell, and every change
 * leaves a StockMovement row. A CHECK constraint in the database is the last safety net.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  async adjust(
    tx: Prisma.TransactionClient,
    change: StockChange,
  ): Promise<StockResult> {
    if (!Number.isInteger(change.delta) || change.delta === 0) {
      throw new BadRequestException(
        'Stock change must be a non-zero whole number',
      );
    }
    const rows = await tx.$queryRaw<{ stock: number }[]>`
      UPDATE "Product"
      SET "stock" = "stock" + ${change.delta}, "updatedAt" = NOW()
      WHERE "id" = ${change.productId} AND "stock" + ${change.delta} >= 0
      RETURNING "stock"`;
    if (rows.length === 0) {
      const product = await tx.product.findUnique({
        where: { id: change.productId },
        select: { name: true, stock: true },
      });
      if (!product) throw new NotFoundException('Product not found');
      throw new BadRequestException(
        `Not enough stock for "${product.name}": ${product.stock} left, ${-change.delta} requested`,
      );
    }
    const stockAfter = Number(rows[0].stock);
    await tx.stockMovement.create({
      data: {
        productId: change.productId,
        delta: change.delta,
        stockAfter,
        reason: change.reason,
        actorId: change.actorId ?? null,
        orderId: change.orderId ?? null,
        note: change.note ?? null,
      },
    });
    return {
      productId: change.productId,
      stockBefore: stockAfter - change.delta,
      stockAfter,
    };
  }

  /**
   * Applies several changes in product-id order (a fixed lock order means two
   * concurrent orders sharing products can't deadlock).
   */
  async adjustMany(
    tx: Prisma.TransactionClient,
    changes: StockChange[],
  ): Promise<StockResult[]> {
    const sorted = [...changes].sort((a, b) =>
      a.productId.localeCompare(b.productId),
    );
    const results: StockResult[] = [];
    for (const c of sorted) results.push(await this.adjust(tx, c));
    return results;
  }

  /**
   * Admin alerts for products that just crossed their low-stock level (or ran out).
   * Call inside the same transaction; publish the returned rows after commit.
   */
  async lowStockAlerts(
    tx: Prisma.TransactionClient,
    results: StockResult[],
  ): Promise<Notification[]> {
    const dropped = results.filter((r) => r.stockAfter < r.stockBefore);
    if (dropped.length === 0) return [];
    const { defaultLowStockThreshold } = await this.settings.get();
    const products = await tx.product.findMany({
      where: { id: { in: dropped.map((r) => r.productId) } },
      select: { id: true, name: true, lowStockThreshold: true },
    });
    const out: Notification[] = [];
    for (const r of dropped) {
      const p = products.find((x) => x.id === r.productId);
      if (!p) continue;
      const threshold = p.lowStockThreshold ?? defaultLowStockThreshold;
      const crossed = r.stockBefore > threshold && r.stockAfter <= threshold;
      const ranOut = r.stockBefore > 0 && r.stockAfter === 0;
      if (!crossed && !ranOut) continue;
      out.push(
        ...(await this.notifications.notifyAdmins(tx, {
          type: NotificationType.LOW_STOCK,
          content:
            r.stockAfter === 0
              ? `Out of stock: "${p.name}".`
              : `Low stock: "${p.name}" has ${r.stockAfter} left (alert level ${threshold}).`,
          entityType: 'Product',
          entityId: p.id,
          link: `/admin/products/${p.id}`,
        })),
      );
    }
    return out;
  }
}

export function effectiveThreshold(
  lowStockThreshold: number | null,
  fallback: number,
): number {
  return lowStockThreshold ?? fallback;
}

/** Badge for the products table. */
export function stockLevel(
  stock: number,
  threshold: number,
): 'OUT_OF_STOCK' | 'LOW_STOCK' | 'IN_STOCK' {
  if (stock <= 0) return 'OUT_OF_STOCK';
  if (stock <= threshold) return 'LOW_STOCK';
  return 'IN_STOCK';
}
