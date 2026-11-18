import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAccess } from '../../auth/decorator/require-permission.decorator';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { AdminClientsService } from './admin-clients.service';
import { AdminClientsQueryDto } from './dto/admin-clients-query.dto';

/** Suspend / reactivate a client with POST /admin/users/:id/suspend|reactivate. */
@ApiTags('admin-clients')
@Controller('admin/clients')
@AdminAccess('users', 'read')
export class AdminClientsController {
  constructor(private readonly clients: AdminClientsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Clients with reservation and order counters (sortable by any counter)',
  })
  list(@Query() query: AdminClientsQueryDto) {
    return this.clients.list(query);
  }

  @Get(':userId')
  @ApiOperation({
    summary:
      'Client profile: personal info, contact, location, activity, counters, status history',
  })
  detail(@Param('userId') userId: string) {
    return this.clients.detail(userId);
  }

  @Get(':userId/reservations')
  @ApiOperation({
    summary:
      "Client's reservation history (sortDir applies to the appointment date)",
  })
  reservations(@Param('userId') userId: string, @Query() query: ListQueryDto) {
    return this.clients.reservations(userId, query);
  }

  @Get(':userId/orders')
  @ApiOperation({ summary: "Client's marketplace order history" })
  orders(@Param('userId') userId: string, @Query() query: ListQueryDto) {
    return this.clients.orders(userId, query);
  }
}
