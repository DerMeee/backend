import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { GetProductsQueryDto } from './dto/get-products-query.dto';
import { AddProductImagesDto } from './dto/add-product-images.dto';
import { CreateRatingDto } from './dto/create-rating.dto';
import { RatingResponseDto } from './dto/rating-response.dto';
import { PaginatedResponseDto } from '../appointment/dto/pagination-resp.dto';
import { catchServiceError } from '../utils/catch-service-error';

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Product CRUD ────────────────────────────────────────────────────────────

  async create(dto: CreateProductDto): Promise<ProductResponseDto> {
    try {
      const product = await this.prisma.product.create({
        data: {
          name: dto.name,
          description: dto.description,
          brand: dto.brand,
          price: dto.price,
          category: dto.category,
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
        include: { images: { orderBy: { order: 'asc' } } },
      });
      return this.toResponse(product);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async findAll(
    query: GetProductsQueryDto,
  ): Promise<PaginatedResponseDto<ProductResponseDto>> {
    try {
      const page = query.page || 1;
      const limit = query.limit || 10;
      const skip = (page - 1) * limit;

      const where: any = {};
      if (query.category) where.category = query.category;
      if (query.search) {
        where.OR = [
          { name: { contains: query.search, mode: 'insensitive' } },
          { brand: { contains: query.search, mode: 'insensitive' } },
        ];
      }

      const [totalCount, products] = await Promise.all([
        this.prisma.product.count({ where }),
        this.prisma.product.findMany({
          where,
          include: { images: { orderBy: { order: 'asc' } } },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: products.map((p) => this.toResponse(p)),
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async findOne(id: string): Promise<ProductResponseDto> {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
        include: { images: { orderBy: { order: 'asc' } } },
      });
      if (!product) throw new NotFoundException('Product not found');
      return this.toResponse(product);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async update(id: string, dto: UpdateProductDto): Promise<ProductResponseDto> {
    try {
      const existing = await this.prisma.product.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Product not found');

      const product = await this.prisma.product.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          brand: dto.brand,
          price: dto.price,
          category: dto.category,
        },
        include: { images: { orderBy: { order: 'asc' } } },
      });
      return this.toResponse(product);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async remove(id: string): Promise<{ message: string; data: { id: string } }> {
    try {
      const existing = await this.prisma.product.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Product not found');

      const product = await this.prisma.product.delete({ where: { id } });
      return { message: 'Product deleted successfully', data: { id: product.id } };
    } catch (error) {
      catchServiceError(error);
    }
  }

  // ── Image management ────────────────────────────────────────────────────────

  async addImages(productId: string, dto: AddProductImagesDto): Promise<ProductResponseDto> {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        include: { images: true },
      });
      if (!product) throw new NotFoundException('Product not found');

      const maxOrder = product.images.reduce((m, img) => Math.max(m, img.order), -1);
      const hasPrimary = product.images.some((img) => img.isPrimary);

      await this.prisma.productImage.createMany({
        data: dto.images.map((url, i) => ({
          productId,
          url,
          isPrimary: !hasPrimary && i === 0,
          order: maxOrder + i + 1,
        })),
      });

      const updated = await this.prisma.product.findUnique({
        where: { id: productId },
        include: { images: { orderBy: { order: 'asc' } } },
      });
      return this.toResponse(updated);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async removeImage(
    productId: string,
    imageId: string,
  ): Promise<{ message: string }> {
    try {
      const image = await this.prisma.productImage.findUnique({ where: { id: imageId } });
      if (!image || image.productId !== productId)
        throw new NotFoundException('Image not found');

      await this.prisma.productImage.delete({ where: { id: imageId } });

      if (image.isPrimary) {
        const next = await this.prisma.productImage.findFirst({
          where: { productId },
          orderBy: { order: 'asc' },
        });
        if (next) {
          await this.prisma.productImage.update({
            where: { id: next.id },
            data: { isPrimary: true },
          });
        }
      }

      return { message: 'Image removed successfully' };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async setPrimaryImage(
    productId: string,
    imageId: string,
  ): Promise<{ message: string }> {
    try {
      const image = await this.prisma.productImage.findUnique({ where: { id: imageId } });
      if (!image || image.productId !== productId)
        throw new NotFoundException('Image not found');

      await this.prisma.$transaction([
        this.prisma.productImage.updateMany({
          where: { productId },
          data: { isPrimary: false },
        }),
        this.prisma.productImage.update({
          where: { id: imageId },
          data: { isPrimary: true },
        }),
      ]);

      return { message: 'Primary image updated' };
    } catch (error) {
      catchServiceError(error);
    }
  }

  // ── Ratings ─────────────────────────────────────────────────────────────────

  async addRating(
    productId: string,
    userId: string,
    dto: CreateRatingDto,
  ): Promise<RatingResponseDto> {
    try {
      const [product, patient] = await Promise.all([
        this.prisma.product.findUnique({ where: { id: productId } }),
        this.prisma.patient.findUnique({ where: { userId } }),
      ]);
      if (!product) throw new NotFoundException('Product not found');
      if (!patient) throw new ForbiddenException('Patient profile not found');

      const exists = await this.prisma.productRating.findUnique({
        where: { productId_patientId: { productId, patientId: patient.id } },
      });
      if (exists)
        throw new ConflictException('You have already rated this product');

      const rating = await this.prisma.productRating.create({
        data: { productId, patientId: patient.id, score: dto.score, review: dto.review },
        include: { patient: { include: { user: { select: { name: true } } } } },
      });

      await this.recalcRating(productId);
      return this.toRatingResponse(rating);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async getRatings(
    productId: string,
    query: { page?: number; limit?: number },
  ): Promise<PaginatedResponseDto<RatingResponseDto>> {
    try {
      const product = await this.prisma.product.findUnique({ where: { id: productId } });
      if (!product) throw new NotFoundException('Product not found');

      const page = query.page || 1;
      const limit = query.limit || 10;
      const skip = (page - 1) * limit;

      const [totalCount, ratings] = await Promise.all([
        this.prisma.productRating.count({ where: { productId } }),
        this.prisma.productRating.findMany({
          where: { productId },
          include: { patient: { include: { user: { select: { name: true } } } } },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: ratings.map((r) => this.toRatingResponse(r)),
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async updateRating(
    productId: string,
    userId: string,
    dto: CreateRatingDto,
  ): Promise<RatingResponseDto> {
    try {
      const patient = await this.prisma.patient.findUnique({ where: { userId } });
      if (!patient) throw new ForbiddenException('Patient profile not found');

      const existing = await this.prisma.productRating.findUnique({
        where: { productId_patientId: { productId, patientId: patient.id } },
      });
      if (!existing) throw new NotFoundException('Rating not found');

      const rating = await this.prisma.productRating.update({
        where: { productId_patientId: { productId, patientId: patient.id } },
        data: { score: dto.score, review: dto.review },
        include: { patient: { include: { user: { select: { name: true } } } } },
      });

      await this.recalcRating(productId);
      return this.toRatingResponse(rating);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async deleteRating(
    productId: string,
    userId: string,
  ): Promise<{ message: string }> {
    try {
      const patient = await this.prisma.patient.findUnique({ where: { userId } });
      if (!patient) throw new ForbiddenException('Patient profile not found');

      const existing = await this.prisma.productRating.findUnique({
        where: { productId_patientId: { productId, patientId: patient.id } },
      });
      if (!existing) throw new NotFoundException('Rating not found');

      await this.prisma.productRating.delete({
        where: { productId_patientId: { productId, patientId: patient.id } },
      });

      await this.recalcRating(productId);
      return { message: 'Rating deleted successfully' };
    } catch (error) {
      catchServiceError(error);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async recalcRating(productId: string): Promise<void> {
    const agg = await this.prisma.productRating.aggregate({
      where: { productId },
      _avg: { score: true },
    });
    await this.prisma.product.update({
      where: { id: productId },
      data: { rating: Math.round((agg._avg.score ?? 0) * 10) / 10 },
    });
  }

  private toResponse(product: any): ProductResponseDto {
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      brand: product.brand,
      price: product.price,
      category: product.category,
      rating: product.rating,
      images: (product.images ?? []).map((img: any) => ({
        id: img.id,
        url: img.url,
        isPrimary: img.isPrimary,
        order: img.order,
      })),
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  private toRatingResponse(rating: any): RatingResponseDto {
    return {
      id: rating.id,
      productId: rating.productId,
      patientId: rating.patientId,
      patientName: rating.patient?.user?.name ?? null,
      score: rating.score,
      review: rating.review ?? null,
      createdAt: rating.createdAt,
      updatedAt: rating.updatedAt,
    };
  }
}
