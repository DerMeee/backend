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
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { AccountStatusService } from '../accounts/account-status.service';
import { OptionalNoteDto, RequiredReasonDto } from '../dto/reason.dto';
import { AdminDoctorsService } from './admin-doctors.service';
import { AdminDoctorsQueryDto } from './dto/admin-doctors-query.dto';

/** `:userId` is the doctor's User.id (same id as in the users table). */
@ApiTags('admin-doctors')
@Controller('admin/doctors')
export class AdminDoctorsController {
  constructor(
    private readonly doctors: AdminDoctorsService,
    private readonly accounts: AccountStatusService,
  ) {}

  @Get()
  @AdminAccess('doctors', 'read')
  @ApiOperation({
    summary:
      'Doctors with approval status, location, reservation counts and allowed row actions',
  })
  list(@Query() query: AdminDoctorsQueryDto) {
    return this.doctors.list(query);
  }

  @Get(':userId')
  @AdminAccess('doctors', 'read')
  @ApiOperation({
    summary:
      'Doctor profile: professional info, verification, documents, approval history, stats',
  })
  detail(@Param('userId') userId: string) {
    return this.doctors.detail(userId);
  }

  @Get(':userId/documents')
  @AdminAccess('doctors', 'read')
  @ApiOperation({
    summary:
      'Verification documents (download each via its `url`, with the Bearer token)',
  })
  documents(@Param('userId') userId: string) {
    return this.doctors.documents(userId);
  }

  @Get(':userId/reservations')
  @AdminAccess('doctors', 'read')
  @ApiOperation({ summary: "Doctor's reservation history" })
  reservations(@Param('userId') userId: string, @Query() query: ListQueryDto) {
    return this.doctors.reservations(userId, query);
  }

  @Get(':userId/approval-history')
  @AdminAccess('doctors', 'read')
  @ApiOperation({
    summary:
      'Approval and suspension history with the admin behind each decision',
  })
  history(@Param('userId') userId: string) {
    return this.accounts.historyFor(userId);
  }

  @Post(':userId/approve')
  @HttpCode(200)
  @AdminAccess('doctors', 'update')
  @ApiOperation({
    summary: 'Approve a pending (or previously rejected) doctor',
  })
  approve(
    @Param('userId') userId: string,
    @Body() body: OptionalNoteDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.accounts.approveDoctor(userId, body.reason, actor);
  }

  @Post(':userId/reject')
  @HttpCode(200)
  @AdminAccess('doctors', 'update')
  @ApiOperation({
    summary: 'Reject a pending doctor (reason required, shown to the doctor)',
  })
  reject(
    @Param('userId') userId: string,
    @Body() body: RequiredReasonDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.accounts.rejectDoctor(userId, body.reason, actor);
  }

  @Post(':userId/re-review')
  @HttpCode(200)
  @AdminAccess('doctors', 'update')
  @ApiOperation({ summary: 'Put a rejected doctor back into the review queue' })
  reReview(
    @Param('userId') userId: string,
    @Body() body: OptionalNoteDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.accounts.reReviewDoctor(userId, body.reason, actor);
  }

  @Post(':userId/suspend')
  @HttpCode(200)
  @AdminAccess('doctors', 'update')
  @ApiOperation({
    summary:
      'Suspend the doctor account (reason required). Hidden from patients and signed out.',
  })
  suspend(
    @Param('userId') userId: string,
    @Body() body: RequiredReasonDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.accounts.suspend(userId, body.reason, actor);
  }

  @Post(':userId/reactivate')
  @HttpCode(200)
  @AdminAccess('doctors', 'update')
  @ApiOperation({
    summary: 'Reactivate a suspended doctor (keeps the approval status)',
  })
  reactivate(
    @Param('userId') userId: string,
    @Body() body: OptionalNoteDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.accounts.reactivate(userId, body.reason, actor);
  }
}
