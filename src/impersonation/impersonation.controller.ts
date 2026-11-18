import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AdminAccess } from '../auth/decorator/require-permission.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-aut.guard';
import { CurrentUser } from '../auth/decorator/current-user.decorator';
import { CurrentActor } from '../common/decorators/actor.decorator';
import type { Actor, RequestUser } from '../common/request-user';
import { ListQueryDto } from '../common/dto/list-query.dto';
import { ImpersonationService } from './impersonation.service';
import { AllowDuringImpersonation } from './allow-during-impersonation.decorator';

export class StartImpersonationDto {
  @ApiPropertyOptional({
    example: 'Investigating a booking issue reported by phone',
    maxLength: 300,
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

class SessionsQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  adminId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  targetUserId?: string;
}

/** Admin side: start a "view as user" session, list past sessions, force-end one. */
@ApiTags('admin-impersonation')
@Controller('admin/impersonation')
export class AdminImpersonationController {
  constructor(private readonly impersonation: ImpersonationService) {}

  @Post('users/:userId')
  @AdminAccess('impersonation', 'create')
  @ApiOperation({
    summary: 'View the platform as a client or doctor (read-only, 30 min)',
    description:
      'Returns a separate access token. Keep your admin tokens; send this one instead while the banner is shown. Every write request with it gets 403.',
  })
  start(
    @Param('userId') userId: string,
    @Body() body: StartImpersonationDto,
    @CurrentActor() actor: Actor,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.impersonation.start(actor, userId, body.reason, userAgent);
  }

  @Get('sessions')
  @AdminAccess('impersonation', 'create')
  @ApiOperation({
    summary: 'Impersonation sessions (who, whom, when started / ended)',
  })
  sessions(@Query() q: SessionsQueryDto) {
    return this.impersonation.list(q.page, q.limit, q.adminId, q.targetUserId);
  }

  @Post('sessions/:id/end')
  @HttpCode(200)
  @AdminAccess('impersonation', 'create')
  @ApiOperation({ summary: 'End one of my sessions from the admin side' })
  end(@Param('id') id: string, @CurrentActor() actor: Actor) {
    return this.impersonation.end(id, { userId: actor.userId }, actor);
  }
}

/** Called with the impersonation token itself (the banner). */
@ApiTags('impersonation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('impersonation')
export class ImpersonationController {
  constructor(private readonly impersonation: ImpersonationService) {}

  @Get('current')
  @ApiOperation({
    summary: 'Banner info: who is viewing as whom, and until when',
  })
  current(@CurrentUser() user: RequestUser) {
    return this.impersonation.current(user);
  }

  @Post('end')
  @HttpCode(200)
  @AllowDuringImpersonation()
  @ApiOperation({
    summary:
      'Exit "view as user". The impersonation token stops working immediately.',
  })
  end(@CurrentUser() user: RequestUser, @CurrentActor() actor: Actor) {
    if (!user.impersonationSessionId) return { impersonating: false };
    return this.impersonation.end(user.impersonationSessionId, user, actor);
  }
}
