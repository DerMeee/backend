import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAccess } from '../auth/decorator/require-permission.decorator';
import { CurrentActor } from '../common/decorators/actor.decorator';
import type { Actor } from '../common/request-user';
import { AdminOrdersService } from './admin-orders.service';
import {
  AdminOrdersQueryDto,
  UpdateDeliveryDto,
  UpdateOrderStatusDto,
  UpdatePaymentStatusDto,
} from './dto/admin-order.dto';

@ApiTags('admin-orders')
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly orders: AdminOrdersService) {}

  @Get('stats')
  @AdminAccess('orders', 'read')
  @ApiOperation({
    summary: 'Order counts by status / payment / delivery, and paid revenue',
  })
  stats() {
    return this.orders.stats();
  }

  @Get()
  @AdminAccess('orders', 'read')
  @ApiOperation({
    summary:
      'Orders with filters (date, customer, wilaya/commune, product, 3 statuses)',
  })
  list(@Query() query: AdminOrdersQueryDto) {
    return this.orders.list(query);
  }

  @Get(':id')
  @AdminAccess('orders', 'read')
  @ApiOperation({
    summary:
      'Order details: customer, address, items, payment, delivery, history, allowed actions',
  })
  detail(@Param('id') id: string) {
    return this.orders.detail(id);
  }

  @Post(':id/status')
  @HttpCode(200)
  @AdminAccess('orders', 'update')
  @ApiOperation({
    summary: 'Confirm, reject or cancel an order',
    description:
      'Reject / cancel need a reason and give the units back to stock.',
  })
  setStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.orders.setStatus(id, dto, actor);
  }

  @Post(':id/payment')
  @HttpCode(200)
  @AdminAccess('orders', 'update')
  @ApiOperation({
    summary:
      'Set the payment status (PAID, FAILED, REFUNDED…), independent of the order status',
  })
  setPayment(
    @Param('id') id: string,
    @Body() dto: UpdatePaymentStatusDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.orders.setPayment(id, dto, actor);
  }

  @Post(':id/delivery')
  @HttpCode(200)
  @AdminAccess('orders', 'update')
  @ApiOperation({
    summary:
      'Update delivery: status and/or company, tracking number, update note',
    description: 'Sending requires a confirmed order and a delivery company.',
  })
  setDelivery(
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.orders.setDelivery(id, dto, actor);
  }
}
