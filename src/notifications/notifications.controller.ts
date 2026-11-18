import {
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-aut.guard';
import { CurrentUser } from '../auth/decorator/current-user.decorator';
import type { RequestUser } from '../common/request-user';
import { NotificationsService } from './notifications.service';
import { NotificationsQueryDto } from './dto/notifications-query.dto';

/** The current user's notifications (admins, doctors and patients alike). Live updates arrive as the `notification` socket event. */
@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'My notifications, newest first (includes the unread count)',
  })
  list(
    @CurrentUser() user: RequestUser,
    @Query() query: NotificationsQueryDto,
  ) {
    return this.notifications.list(user.userId, query);
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'Number of unread notifications (for the bell badge)',
  })
  unreadCount(@CurrentUser() user: RequestUser) {
    return this.notifications.unreadCount(user.userId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  markRead(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.notifications.markRead(user.userId, id);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all my notifications as read' })
  markAllRead(@CurrentUser() user: RequestUser) {
    return this.notifications.markAllRead(user.userId);
  }
}
