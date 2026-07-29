import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { GetProductsQueryDto } from './dto/get-products-query.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { AddProductImagesDto } from './dto/add-product-images.dto';
import { CreateRatingDto } from './dto/create-rating.dto';
import { RatingResponseDto } from './dto/rating-response.dto';
import { PaginatedResponseDto } from '../appointment/dto/pagination-resp.dto';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-aut.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { Permissions } from '../auth/decorator/require-permission.decorator';
import { CurrentUser } from '../auth/decorator/current-user.decorator';

@ApiTags('products')
@ApiExtraModels(ProductResponseDto, RatingResponseDto, PaginatedResponseDto)
@Controller('product')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  // ── Listing & detail (public) ────────────────────────────────────────────────

  @ApiOperation({ summary: 'Get all products with pagination and filters' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'search', required: false, description: 'Search by name or brand' })
  @ApiOkResponse({
    description: 'Paginated list of products',
    schema: {
      allOf: [{ $ref: getSchemaPath(PaginatedResponseDto) }],
      properties: {
        data: { type: 'array', items: { $ref: getSchemaPath(ProductResponseDto) } },
      },
    },
  })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @Get()
  findAll(
    @Query() query: GetProductsQueryDto,
  ): Promise<PaginatedResponseDto<ProductResponseDto>> {
    return this.productService.findAll(query);
  }

  @ApiOperation({ summary: 'Get a product by ID' })
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiNotFoundResponse({ description: 'Product not found' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @Get(':id')
  findOne(@Param('id') id: string): Promise<ProductResponseDto> {
    return this.productService.findOne(id);
  }

  // ── Admin CRUD ───────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Create a product (Admin)' })
  @ApiCreatedResponse({ type: ProductResponseDto })
  @ApiBadRequestResponse({ description: 'Validation error' })
  @ApiForbiddenResponse({ description: 'Admin access required' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions([{ resource: 'products', action: 'create' }])
  @Post()
  create(@Body() dto: CreateProductDto): Promise<ProductResponseDto> {
    return this.productService.create(dto);
  }

  @ApiOperation({ summary: 'Update a product (Admin)' })
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiNotFoundResponse({ description: 'Product not found' })
  @ApiForbiddenResponse({ description: 'Admin access required' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions([{ resource: 'products', action: 'update' }])
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    return this.productService.update(id, dto);
  }

  @ApiOperation({ summary: 'Delete a product (Admin)' })
  @ApiOkResponse({ description: 'Product deleted' })
  @ApiNotFoundResponse({ description: 'Product not found' })
  @ApiForbiddenResponse({ description: 'Admin access required' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions([{ resource: 'products', action: 'delete' }])
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productService.remove(id);
  }

  // ── Image management (Admin) ──────────────────────────────────────────────────

  @ApiOperation({ summary: 'Add images to a product (Admin)' })
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiNotFoundResponse({ description: 'Product not found' })
  @ApiForbiddenResponse({ description: 'Admin access required' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions([{ resource: 'products', action: 'update' }])
  @Post(':id/images')
  addImages(
    @Param('id') id: string,
    @Body() dto: AddProductImagesDto,
  ): Promise<ProductResponseDto> {
    return this.productService.addImages(id, dto);
  }

  @ApiOperation({ summary: 'Remove an image from a product (Admin)' })
  @ApiOkResponse({ description: 'Image removed' })
  @ApiNotFoundResponse({ description: 'Image not found' })
  @ApiForbiddenResponse({ description: 'Admin access required' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions([{ resource: 'products', action: 'update' }])
  @Delete(':id/images/:imageId')
  removeImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.productService.removeImage(id, imageId);
  }

  @ApiOperation({ summary: 'Set a product image as primary (Admin)' })
  @ApiOkResponse({ description: 'Primary image updated' })
  @ApiNotFoundResponse({ description: 'Image not found' })
  @ApiForbiddenResponse({ description: 'Admin access required' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions([{ resource: 'products', action: 'update' }])
  @Patch(':id/images/:imageId/primary')
  setPrimary(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.productService.setPrimaryImage(id, imageId);
  }

  // ── Ratings ───────────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Get ratings for a product (public, paginated)' })
  @ApiOkResponse({
    schema: {
      allOf: [{ $ref: getSchemaPath(PaginatedResponseDto) }],
      properties: {
        data: { type: 'array', items: { $ref: getSchemaPath(RatingResponseDto) } },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Product not found' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @Get(':id/ratings')
  getRatings(
    @Param('id') id: string,
    @Query() query: GetProductsQueryDto,
  ): Promise<PaginatedResponseDto<RatingResponseDto>> {
    return this.productService.getRatings(id, query);
  }

  @ApiOperation({ summary: 'Rate a product (Patient)' })
  @ApiCreatedResponse({ type: RatingResponseDto })
  @ApiConflictResponse({ description: 'Already rated this product' })
  @ApiNotFoundResponse({ description: 'Product not found' })
  @ApiForbiddenResponse({ description: 'Patient access required' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @UseGuards(JwtAuthGuard)
  @Post(':id/ratings')
  addRating(
    @Param('id') id: string,
    @Body() dto: CreateRatingDto,
    @CurrentUser() user: any,
  ): Promise<RatingResponseDto> {
    return this.productService.addRating(id, user.userId, dto);
  }

  @ApiOperation({ summary: 'Update my rating for a product (Patient)' })
  @ApiOkResponse({ type: RatingResponseDto })
  @ApiNotFoundResponse({ description: 'Rating not found' })
  @ApiForbiddenResponse({ description: 'Patient access required' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @UseGuards(JwtAuthGuard)
  @Patch(':id/ratings/me')
  updateRating(
    @Param('id') id: string,
    @Body() dto: CreateRatingDto,
    @CurrentUser() user: any,
  ): Promise<RatingResponseDto> {
    return this.productService.updateRating(id, user.userId, dto);
  }

  @ApiOperation({ summary: 'Delete my rating for a product (Patient)' })
  @ApiOkResponse({ description: 'Rating deleted' })
  @ApiNotFoundResponse({ description: 'Rating not found' })
  @ApiForbiddenResponse({ description: 'Patient access required' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @UseGuards(JwtAuthGuard)
  @Delete(':id/ratings/me')
  deleteRating(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.productService.deleteRating(id, user.userId);
  }
}
