import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAccess } from '../auth/decorator/require-permission.decorator';
import { AuditService } from './audit.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

@ApiTags('admin-audit-logs')
@Controller('admin/audit-logs')
@AdminAccess('audit-logs', 'read')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({
    summary:
      'Administrative activity log (filter by actor, action, entity, dates)',
  })
  list(@Query() query: AuditLogQueryDto) {
    return this.audit.list(query);
  }
}
