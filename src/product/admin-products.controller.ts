import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAccess } from '../auth/decorator/require-permission.decorator';
import { CurrentActor } from '../common/decorators/actor.decorator';
import type { Actor } from '../common/request-user';
import { ListQueryDto } from '../common/dto/list-query.dto';
import { AdminProductsService } from './admin-products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  AdminProductsQueryDto,
  SetProductStatusDto,
  StockAdjustmentDto,
} from './dto/admin-product.dto';
import { productImageMulterOptions } from './product-image-upload.config';

@ApiTags('admin-products')
@Controller('admin/products')
export class AdminProductsController {
  constructor(private readonly products: AdminProductsService) {}

  @Get()
  @AdminAccess('products', 'read')
  @ApiOperation({
    summary:
      'All products with stock level badges (archived only with status=ARCHIVED)',
  })
  list(@Query() query: AdminProductsQueryDto) {
    return this.products.list(query);
  }

  @Get('alerts')
  @AdminAccess('products', 'read')
  @ApiOperation({ summary: 'Low-stock and out-of-stock products' })
  alerts() {
    return this.products.alerts();
  }

  @Get(':id')
  @AdminAccess('products', 'read')
  @ApiOperation({ summary: 'One product (admin view)' })
  detail(@Param('id') id: string) {
    return this.products.detail(id);
  }

  @Post()
  @AdminAccess('products', 'create')
  @ApiOperation({
    summary: 'Create a product (initial stock is recorded as a stock movement)',
  })
  create(@Body() dto: CreateProductDto, @CurrentActor() actor: Actor) {
    return this.products.create(dto, actor);
  }

  @Patch(':id')
  @AdminAccess('products', 'update')
  @ApiOperation({
    summary:
      'Edit product info and price (stock changes go through stock adjustments)',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.products.update(id, dto, actor);
  }

  @Patch(':id/status')
  @AdminAccess('products', 'update')
  @ApiOperation({ summary: 'Publish, unpublish or archive' })
  setStatus(
    @Param('id') id: string,
    @Body() dto: SetProductStatusDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.products.setStatus(id, dto.status, actor);
  }

  @Delete(':id')
  @AdminAccess('products', 'delete')
  @ApiOperation({
    summary:
      'Delete a product. If it was ever ordered it is archived instead (see the response).',
  })
  remove(@Param('id') id: string, @CurrentActor() actor: Actor) {
    return this.products.remove(id, actor);
  }

  @Post(':id/stock-adjustments')
  @HttpCode(200)
  @AdminAccess('products', 'update')
  @ApiOperation({
    summary: 'Add or remove units. Refused if the result would be negative.',
  })
  adjustStock(
    @Param('id') id: string,
    @Body() dto: StockAdjustmentDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.products.adjustStock(id, dto, actor);
  }

  @Get(':id/stock-movements')
  @AdminAccess('products', 'read')
  @ApiOperation({
    summary:
      'Stock movement history (initial, adjustments, orders, releases, returns)',
  })
  movements(@Param('id') id: string, @Query() query: ListQueryDto) {
    return this.products.movements(id, query.page, query.limit);
  }

  @Post(':id/images/upload')
  @AdminAccess('products', 'update')
  @ApiOperation({
    summary:
      'Upload a product photo (JPEG/PNG/WebP, 5 MB max). First photo becomes primary.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file', productImageMulterOptions()))
  upload(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentActor() actor: Actor,
  ) {
    return this.products.addUploadedImage(id, file, actor);
  }
}
