import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { CancelOrderDto, CreateOrderDto } from './dto/create-order.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { PaginatedResponseDto } from '../appointment/dto/pagination-resp.dto';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
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
import { CurrentUser } from '../auth/decorator/current-user.decorator';
import { AdminAccess } from '../auth/decorator/require-permission.decorator';
import { AdminOrdersService } from './admin-orders.service';
import { AdminOrdersQueryDto } from './dto/admin-order.dto';

/**
 * Patient checkout and order history. Admin order management lives under /admin/orders
 * (GET /orders is kept as an alias of the admin list for existing clients).
 */
@ApiTags('orders')
@ApiBearerAuth()
@ApiExtraModels(OrderResponseDto, PaginatedResponseDto)
@Controller('orders')
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly adminOrders: AdminOrdersService,
  ) {}

  // ── Patient routes ────────────────────────────────────────────────────────────

  @ApiOperation({
    summary: 'Place an order from my current cart (Patient)',
    description:
      'Reserves the stock immediately. Delivery fields left empty are filled from the profile.',
  })
  @ApiCreatedResponse({ type: OrderResponseDto })
  @ApiBadRequestResponse({
    description:
      'Cart empty, item unavailable, not enough stock, or missing address',
  })
  @ApiForbiddenResponse({ description: 'Patient profile not found' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @UseGuards(JwtAuthGuard)
  @Post()
  createOrder(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: any,
  ): Promise<OrderResponseDto> {
    return this.orderService.createFromCart(user.userId, dto);
  }

  @ApiOperation({ summary: 'Get my orders (Patient)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse({
    schema: {
      allOf: [{ $ref: getSchemaPath(PaginatedResponseDto) }],
      properties: {
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(OrderResponseDto) },
        },
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMyOrders(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @CurrentUser() user: any,
  ): Promise<PaginatedResponseDto<OrderResponseDto>> {
    return this.orderService.getMyOrders(user.userId, {
      page: Number(page),
      limit: Number(limit),
    });
  }

  @ApiOperation({ summary: 'Get one of my orders (Patient)' })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @UseGuards(JwtAuthGuard)
  @Get('me/:id')
  getOrder(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ): Promise<OrderResponseDto> {
    return this.orderService.getOrderById(user.userId, id);
  }

  @ApiOperation({
    summary:
      'Cancel my order while it is still pending (Patient). Stock is released.',
  })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiBadRequestResponse({ description: 'Order is no longer pending' })
  @UseGuards(JwtAuthGuard)
  @Patch('me/:id/cancel')
  cancelOrder(
    @Param('id') id: string,
    @Body() body: CancelOrderDto,
    @CurrentUser() user: any,
  ): Promise<OrderResponseDto> {
    return this.orderService.cancelOrder(user.userId, id, body?.reason);
  }

  // ── Admin alias ───────────────────────────────────────────────────────────────

  @ApiOperation({
    summary: 'All orders (Admin). Same as GET /admin/orders.',
    deprecated: true,
  })
  @AdminAccess('orders', 'read')
  @Get()
  getAllOrders(@Query() query: AdminOrdersQueryDto) {
    return this.adminOrders.list(query);
  }
}
