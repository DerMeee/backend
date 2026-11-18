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
import { AdminAccess } from '../../auth/decorator/require-permission.decorator';
import { CurrentActor } from '../../common/decorators/actor.decorator';
import type { Actor } from '../../common/request-user';
import { RequiredReasonDto } from '../dto/reason.dto';
import { AdminReservationsService } from './admin-reservations.service';
import {
  AdminReservationsQueryDto,
  ReservationTimeseriesQueryDto,
} from './dto/admin-reservations-query.dto';
import {
  AdminNoteDto,
  ReservationActionDto,
} from './dto/reservation-action.dto';

@ApiTags('admin-reservations')
@Controller('admin/reservations')
export class AdminReservationsController {
  constructor(private readonly reservations: AdminReservationsService) {}

  @Get('stats')
  @AdminAccess('appointments', 'read')
  @ApiOperation({
    summary:
      'Reservation KPI cards (pending doctor, confirmed by doctor / Dermee, upcoming, overdue…)',
  })
  stats() {
    return this.reservations.stats();
  }

  @Get('timeseries')
  @AdminAccess('appointments', 'read')
  @ApiOperation({
    summary: 'Reservation activity over time, split by current state',
  })
  timeseries(@Query() query: ReservationTimeseriesQueryDto) {
    return this.reservations.timeseries(query);
  }

  @Get()
  @AdminAccess('appointments', 'read')
  @ApiOperation({
    summary:
      'Reservations with urgency. Default sort = priority (overdue, then urgent unconfirmed…)',
    description:
      '`search` also accepts a reference like RSV-000123. Thresholds come from /admin/settings.',
  })
  list(@Query() query: AdminReservationsQueryDto) {
    return this.reservations.list(query);
  }

  @Get(':id')
  @AdminAccess('appointments', 'read')
  @ApiOperation({
    summary:
      'Reservation details: parties, status history, admin notes, allowed actions',
  })
  detail(@Param('id') id: string) {
    return this.reservations.detail(id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @AdminAccess('appointments', 'update')
  @ApiOperation({
    summary:
      'Confirm on behalf of Dermee (only after the doctor confirmed, before the visit)',
  })
  confirm(
    @Param('id') id: string,
    @Body() body: ReservationActionDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.reservations.act(id, 'dermeeConfirm', actor, body.note);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @AdminAccess('appointments', 'update')
  @ApiOperation({ summary: 'Mark as completed (after the visit time)' })
  complete(
    @Param('id') id: string,
    @Body() body: ReservationActionDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.reservations.act(id, 'complete', actor, body.note);
  }

  @Post(':id/no-show')
  @HttpCode(200)
  @AdminAccess('appointments', 'update')
  @ApiOperation({ summary: 'Mark as no-show (after the visit time)' })
  noShow(
    @Param('id') id: string,
    @Body() body: ReservationActionDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.reservations.act(id, 'noShow', actor, body.note);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @AdminAccess('appointments', 'update')
  @ApiOperation({
    summary:
      'Cancel a reservation (reason required; patient and doctor are notified)',
  })
  cancel(
    @Param('id') id: string,
    @Body() body: RequiredReasonDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.reservations.act(id, 'cancel', actor, body.reason);
  }

  @Post(':id/notes')
  @AdminAccess('appointments', 'update')
  @ApiOperation({
    summary: 'Add an internal admin note (never shown to doctor or patient)',
  })
  addNote(
    @Param('id') id: string,
    @Body() body: AdminNoteDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.reservations.addNote(id, body.content, actor);
  }
}
