import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Notification, Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/audit-actions';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StockService, stockLevel } from '../inventory/stock.service';
import type { Actor } from '../common/request-user';
import { paginate, resolveSort, skipTake } from '../common/pagination';
import { catchServiceError } from '../utils/catch-service-error';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  AdminProductsQueryDto,
  StockAdjustmentDto,
} from './dto/admin-product.dto';
import { publicProductImagePath } from './product-image-upload.config';
import { unlink } from 'fs/promises';
import { join } from 'path';

const adminProductInclude = {
  images: { orderBy: { order: 'asc' } },
  _count: { select: { orderItems: true } },
} satisfies Prisma.ProductInclude;

type AdminProduct = Prisma.ProductGetPayload<{
  include: typeof adminProductInclude;
}>;

/** Fields shown in before/after audit entries. */
function auditView(p: {
  name: string;
  sku: string | null;
  price: number;
  category: string | null;
  brand: string | null;
  status: ProductStatus;
  lowStockThreshold: number | null;
  description: string | null;
}) {
  return {
    name: p.name,
    sku: p.sku,
    price: p.price,
    category: p.category,
    brand: p.brand,
    status: p.status,
    lowStockThreshold: p.lowStockThreshold,
    description: p.description,
  };
}

@Injectable()
export class AdminProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly stock: StockService,
    private readonly notifications: NotificationsService,
  ) {}

  private map(p: AdminProduct, defaultThreshold: number) {
    const threshold = p.lowStockThreshold ?? defaultThreshold;
    const primary = p.images.find((i) => i.isPrimary) ?? p.images[0];
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      description: p.description,
      brand: p.brand,
      category: p.category,
      price: p.price,
      stock: p.stock,
      lowStockThreshold: p.lowStockThreshold,
      effectiveLowStockThreshold: threshold,
      stockLevel: stockLevel(p.stock, threshold),
      status: p.status,
      rating: p.rating,
      imageUrl: primary?.url ?? null,
      images: p.images.map((i) => ({
        id: i.id,
        url: i.url,
        isPrimary: i.isPrimary,
        order: i.order,
      })),
      /** Products already ordered are archived instead of deleted. */
      hasOrders: p._count.orderItems > 0,
      archivedAt: p.archivedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  async list(q: AdminProductsQueryDto) {
    try {
      const { defaultLowStockThreshold: def } = await this.settings.get();
      const and: Prisma.ProductWhereInput[] = [
        q.status ? { status: q.status } : { status: { not: 'ARCHIVED' } },
      ];
      if (q.category?.trim())
        and.push({
          category: { equals: q.category.trim(), mode: 'insensitive' },
        });
      if (q.search?.trim()) {
        const contains = {
          contains: q.search.trim(),
          mode: 'insensitive' as const,
        };
        and.push({
          OR: [{ name: contains }, { sku: contains }, { brand: contains }],
        });
      }
      if (q.stockLevel === 'OUT_OF_STOCK') and.push({ stock: { lte: 0 } });
      if (q.stockLevel === 'LOW_STOCK' || q.stockLevel === 'IN_STOCK') {
        // Compares two columns (stock vs threshold), which Prisma filters can't express.
        const ids = await this.prisma.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Product"
          WHERE ${
            q.stockLevel === 'LOW_STOCK'
              ? Prisma.sql`"stock" > 0 AND "stock" <= COALESCE("lowStockThreshold", ${def})`
              : Prisma.sql`"stock" > COALESCE("lowStockThreshold", ${def})`
          }`;
        and.push({ id: { in: ids.map((r) => r.id) } });
      }
      const where: Prisma.ProductWhereInput = { AND: and };
      const orderBy = resolveSort<Prisma.ProductOrderByWithRelationInput>(
        q.sortBy,
        {
          createdAt: { createdAt: q.sortDir },
          updatedAt: { updatedAt: q.sortDir },
          name: { name: q.sortDir },
          price: { price: q.sortDir },
          stock: { stock: q.sortDir },
        },
        'createdAt',
      );
      const [total, rows] = await Promise.all([
        this.prisma.product.count({ where }),
        this.prisma.product.findMany({
          where,
          include: adminProductInclude,
          orderBy: [orderBy, { id: q.sortDir }],
          ...skipTake(q.page, q.limit),
        }),
      ]);
      return paginate(
        rows.map((p) => this.map(p, def)),
        total,
        q.page,
        q.limit,
      );
    } catch (error) {
      catchServiceError(error);
    }
  }

  async detail(id: string) {
    try {
      const { defaultLowStockThreshold: def } = await this.settings.get();
      const p = await this.prisma.product.findUnique({
        where: { id },
        include: adminProductInclude,
      });
      if (!p) throw new NotFoundException('Product not found');
      return this.map(p, def);
    } catch (error) {
      catchServiceError(error);
    }
  }

  /** Low-stock and out-of-stock products (published and unpublished), lowest stock first. */
  async alerts() {
    try {
      const { defaultLowStockThreshold: def } = await this.settings.get();
      const ids = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Product"
        WHERE "status"::text <> 'ARCHIVED' AND "stock" <= COALESCE("lowStockThreshold", ${def})
        ORDER BY "stock" ASC, "name" ASC
        LIMIT 200`;
      const rows = await this.prisma.product.findMany({
        where: { id: { in: ids.map((r) => r.id) } },
        include: adminProductInclude,
      });
      const mapped = rows
        .map((p) => this.map(p, def))
        .sort((a, b) => a.stock - b.stock);
      return {
        outOfStock: mapped.filter((p) => p.stockLevel === 'OUT_OF_STOCK'),
        lowStock: mapped.filter((p) => p.stockLevel === 'LOW_STOCK'),
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async create(dto: CreateProductDto, actor: Actor) {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const p = await tx.product.create({
          data: {
            name: dto.name.trim(),
            description: dto.description,
            brand: dto.brand,
            price: dto.price,
            category: dto.category?.trim() || null,
            sku: dto.sku?.trim() || null,
            lowStockThreshold: dto.lowStockThreshold ?? null,
            status: dto.status ?? 'PUBLISHED',
            images: dto.images?.length
              ? {
                  create: dto.images.map((url, i) => ({
                    url,
                    isPrimary: i === 0,
                    order: i,
                  })),
                }
              : undefined,
          },
        });
        if (dto.stock && dto.stock > 0) {
          await this.stock.adjust(tx, {
            productId: p.id,
            delta: dto.stock,
            reason: 'INITIAL',
            actorId: actor.userId,
            note: 'Initial stock',
          });
        }
        await this.audit.log(tx, {
          actor,
          action: AuditAction.PRODUCT_CREATED,
          entityType: AuditEntity.PRODUCT,
          entityId: p.id,
          after: { ...auditView(p), stock: dto.stock ?? 0 },
        });
        return p;
      });
      return this.detail(created.id);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async update(id: string, dto: UpdateProductDto, actor: Actor) {
    try {
      const before = await this.prisma.product.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Product not found');
      await this.prisma.$transaction(async (tx) => {
        const after = await tx.product.update({
          where: { id },
          data: {
            name: dto.name?.trim(),
            description: dto.description,
            brand: dto.brand,
            price: dto.price,
            category:
              dto.category !== undefined
                ? dto.category.trim() || null
                : undefined,
            sku: dto.sku !== undefined ? dto.sku.trim() || null : undefined,
            lowStockThreshold: dto.lowStockThreshold,
            ...(dto.status ? { status: dto.status, archivedAt: null } : {}),
          },
        });
        await this.audit.log(tx, {
          actor,
          action: AuditAction.PRODUCT_UPDATED,
          entityType: AuditEntity.PRODUCT,
          entityId: id,
          before: auditView(before),
          after: auditView(after),
          metadata:
            before.price !== after.price
              ? { priceChange: { from: before.price, to: after.price } }
              : undefined,
        });
      });
      return this.detail(id);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async setStatus(id: string, status: ProductStatus, actor: Actor) {
    try {
      const before = await this.prisma.product.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Product not found');
      if (before.status === status)
        throw new BadRequestException(`Product is already ${status}`);
      await this.prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id },
          data: {
            status,
            archivedAt: status === 'ARCHIVED' ? new Date() : null,
          },
        });
        await this.audit.log(tx, {
          actor,
          action:
            status === 'ARCHIVED'
              ? AuditAction.PRODUCT_ARCHIVED
              : AuditAction.PRODUCT_STATUS_CHANGED,
          entityType: AuditEntity.PRODUCT,
          entityId: id,
          before: { status: before.status },
          after: { status },
        });
      });
      return this.detail(id);
    } catch (error) {
      catchServiceError(error);
    }
  }

  /**
   * Deletes a product that was never ordered. A product that appears in orders is
   * archived instead (hidden from the shop, kept for order history).
   */
  async remove(id: string, actor: Actor) {
    try {
      const p = await this.prisma.product.findUnique({
        where: { id },
        include: adminProductInclude,
      });
      if (!p) throw new NotFoundException('Product not found');
      if (p._count.orderItems > 0) {
        if (p.status !== 'ARCHIVED')
          await this.setStatus(id, 'ARCHIVED', actor);
        return {
          id,
          deleted: false,
          archived: true,
          message: 'Product has orders: archived instead of deleted',
        };
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.cartItem.deleteMany({ where: { productId: id } });
        await tx.wishlist.deleteMany({ where: { productId: id } });
        await tx.product.delete({ where: { id } });
        await this.audit.log(tx, {
          actor,
          action: AuditAction.PRODUCT_DELETED,
          entityType: AuditEntity.PRODUCT,
          entityId: id,
          before: { ...auditView(p), stock: p.stock },
        });
      });
      // Uploaded photos of a deleted product are no longer referenced.
      for (const img of p.images) {
        if (img.url.startsWith('/uploads/products/')) {
          await unlink(join(process.cwd(), img.url.replace(/^\//, ''))).catch(
            () => undefined,
          );
        }
      }
      return { id, deleted: true, archived: false, message: 'Product deleted' };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async adjustStock(id: string, dto: StockAdjustmentDto, actor: Actor) {
    try {
      let alerts: Notification[] = [];
      const result = await this.prisma.$transaction(async (tx) => {
        const r = await this.stock.adjust(tx, {
          productId: id,
          delta: dto.delta,
          reason: dto.reason ?? 'ADJUSTMENT',
          actorId: actor.userId,
          note: dto.note,
        });
        await this.audit.log(tx, {
          actor,
          action: AuditAction.STOCK_ADJUSTED,
          entityType: AuditEntity.PRODUCT,
          entityId: id,
          before: { stock: r.stockBefore },
          after: { stock: r.stockAfter },
          metadata: {
            delta: dto.delta,
            reason: dto.reason ?? 'ADJUSTMENT',
            note: dto.note,
          },
        });
        alerts = await this.stock.lowStockAlerts(tx, [r]);
        return r;
      });
      this.notifications.publish(alerts);
      return { ...result, product: await this.detail(id) };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async movements(id: string, page: number, limit: number) {
    try {
      const exists = await this.prisma.product.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Product not found');
      const where = { productId: id };
      const [total, rows] = await Promise.all([
        this.prisma.stockMovement.count({ where }),
        this.prisma.stockMovement.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          ...skipTake(page, limit),
        }),
      ]);
      const actorIds = [
        ...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x)),
      ];
      const actors = actorIds.length
        ? await this.prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, name: true, role: true },
          })
        : [];
      return paginate(
        rows.map((r) => ({
          ...r,
          actor: actors.find((a) => a.id === r.actorId) ?? null,
        })),
        total,
        page,
        limit,
      );
    } catch (error) {
      catchServiceError(error);
    }
  }

  async addUploadedImage(id: string, file: Express.Multer.File, actor: Actor) {
    try {
      if (!file) throw new BadRequestException('File is required');
      const p = await this.prisma.product.findUnique({
        where: { id },
        include: { images: true },
      });
      if (!p) {
        await unlink(file.path).catch(() => undefined);
        throw new NotFoundException('Product not found');
      }
      const url = publicProductImagePath(id, file.filename);
      await this.prisma.$transaction(async (tx) => {
        await tx.productImage.create({
          data: {
            productId: id,
            url,
            isPrimary: !p.images.some((i) => i.isPrimary),
            order: p.images.reduce((m, i) => Math.max(m, i.order), -1) + 1,
          },
        });
        await this.audit.log(tx, {
          actor,
          action: AuditAction.PRODUCT_UPDATED,
          entityType: AuditEntity.PRODUCT,
          entityId: id,
          metadata: { imageAdded: url },
        });
      });
      return this.detail(id);
    } catch (error) {
      catchServiceError(error);
    }
  }
}
