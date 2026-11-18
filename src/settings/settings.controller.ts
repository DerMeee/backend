import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAccess } from '../auth/decorator/require-permission.decorator';
import { CurrentActor } from '../common/decorators/actor.decorator';
import type { Actor } from '../common/request-user';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@ApiTags('admin-settings')
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @AdminAccess('settings', 'read')
  @ApiOperation({
    summary: 'Current system settings (urgency and stock thresholds)',
  })
  get() {
    return this.settings.get();
  }

  @Patch()
  @AdminAccess('settings', 'update')
  @ApiOperation({
    summary: 'Update settings. mediumHours must stay greater than urgentHours.',
  })
  update(@Body() dto: UpdateSettingsDto, @CurrentActor() actor: Actor) {
    return this.settings.update(dto, actor);
  }
}
