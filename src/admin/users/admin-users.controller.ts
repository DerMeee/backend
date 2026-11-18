import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AdminAccess } from '../../auth/decorator/require-permission.decorator';
import { CurrentActor } from '../../common/decorators/actor.decorator';
import type { Actor } from '../../common/request-user';
import { AdminUsersService } from './admin-users.service';
import {
  AdminUsersQueryDto,
  ExportQueryDto,
} from './dto/admin-users-query.dto';
import { AccountStatusService } from '../accounts/account-status.service';
import { OptionalNoteDto, RequiredReasonDto } from '../dto/reason.dto';

@ApiTags('admin-users')
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly accounts: AccountStatusService,
  ) {}

  @Get()
  @AdminAccess('users', 'read')
  @ApiOperation({
    summary:
      'Registration table: clients and doctors with search, filters, sort, pagination',
  })
  list(@Query() query: AdminUsersQueryDto) {
    return this.users.list(query);
  }

  @Get('export')
  @AdminAccess('users', 'read')
  @ApiProduces(
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOperation({
    summary:
      'Export the filtered users (same filters as the table) as CSV or Excel',
    description:
      'Streamed; capped at 50,000 rows (see X-Total-Rows / X-Exported-Rows headers). Audited.',
  })
  export(
    @Query() query: ExportQueryDto,
    @CurrentActor() actor: Actor,
    @Res() res: Response,
  ) {
    return this.users.export(query, actor, res);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @AdminAccess('users', 'update')
  @ApiOperation({
    summary:
      'Suspend an account (client or doctor). Signs the user out everywhere.',
  })
  suspend(
    @Param('id') id: string,
    @Body() body: RequiredReasonDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.accounts.suspend(id, body.reason, actor);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @AdminAccess('users', 'update')
  @ApiOperation({ summary: 'Reactivate a suspended account' })
  reactivate(
    @Param('id') id: string,
    @Body() body: OptionalNoteDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.accounts.reactivate(id, body.reason, actor);
  }

  @Get(':id/status-history')
  @AdminAccess('users', 'read')
  @ApiOperation({ summary: 'Suspension / approval history of an account' })
  history(@Param('id') id: string) {
    return this.accounts.historyFor(id);
  }
}
