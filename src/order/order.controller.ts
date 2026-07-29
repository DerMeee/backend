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
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStateDto } from './dto/update-order-state.dto';
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
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { Permissions } from '../auth/decorator/require-permission.decorator';
import { CurrentUser } from '../auth/decorator/current-user.decorator';
import { OrderState } from '@prisma/client';

@ApiTags('orders')
@ApiBearerAuth()
@ApiExtraModels(OrderResponseDto, PaginatedResponseDto)
@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  // ── Patient routes ────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Place an order from my current cart (Patient)' })
  @ApiCreatedResponse({ type: OrderResponseDto })
  @ApiBadRequestResponse({ description: 'Cart is empty or validation error' })
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
        data: { type: 'array', items: { $ref: getSchemaPath(OrderResponseDto) } },
      },
    },
  })
  @ApiForbiddenResponse({ description: 'Patient profile not found' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMyOrders(
    @Query() query: { page?: number; limit?: number },
    @CurrentUser() user: any,
  ): Promise<PaginatedResponseDto<OrderResponseDto>> {
    return this.orderService.getMyOrders(user.userId, query);
  }

  @ApiOperation({ summary: 'Get a specific order (Patient)' })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiForbiddenResponse({ description: 'Patient profile not found' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @UseGuards(JwtAuthGuard)
  @Get('me/:id')
  getOrder(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ): Promise<OrderResponseDto> {
    return this.orderService.getOrderById(user.userId, id);
  }

  @ApiOperation({ summary: 'Cancel a pending order (Patient)' })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiBadRequestResponse({ description: 'Order cannot be cancelled (not PENDING)' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiForbiddenResponse({ description: 'Patient profile not found' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @UseGuards(JwtAuthGuard)
  @Patch('me/:id/cancel')
  cancelOrder(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ): Promise<OrderResponseDto> {
    return this.orderService.cancelOrder(user.userId, id);
  }

  // ── Admin routes ──────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Get all orders with optional state filter (Admin)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'state', required: false, enum: OrderState })
  @ApiOkResponse({
    schema: {
      allOf: [{ $ref: getSchemaPath(PaginatedResponseDto) }],
      properties: {
        data: { type: 'array', items: { $ref: getSchemaPath(OrderResponseDto) } },
      },
    },
  })
  @ApiForbiddenResponse({ description: 'Admin access required' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions([{ resource: 'orders', action: 'read' }])
  @Get()
  getAllOrders(
    @Query() query: { page?: number; limit?: number; state?: OrderState },
  ): Promise<PaginatedResponseDto<OrderResponseDto>> {
    return this.orderService.getAllOrders(query);
  }

  @ApiOperation({ summary: 'Update the state of an order (Admin)' })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiBadRequestResponse({ description: 'Cannot update cancelled order' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiForbiddenResponse({ description: 'Admin access required' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions([{ resource: 'orders', action: 'update' }])
  @Patch(':id/state')
  updateState(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStateDto,
  ): Promise<OrderResponseDto> {
    return this.orderService.updateOrderState(id, dto);
  }
}
