import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAccess } from '../../auth/decorator/require-permission.decorator';
import { AdminStatsService } from './admin-stats.service';
import { TimeseriesQueryDto } from './dto/timeseries-query.dto';

@ApiTags('admin-registrations')
@Controller('admin/stats/registrations')
@AdminAccess('admin-dashboard', 'read')
export class AdminStatsController {
  constructor(private readonly stats: AdminStatsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Registration KPI cards (totals, pending doctor approvals, new this month)',
  })
  kpis() {
    return this.stats.registrationKpis();
  }

  @Get('timeseries')
  @ApiOperation({
    summary:
      'Registrations over time, split clients/doctors, with previous-period comparison',
    description:
      'Buckets use Algeria local time; weeks start on Sunday. Empty buckets are returned as 0.',
  })
  timeseries(@Query() query: TimeseriesQueryDto) {
    return this.stats.registrationTimeseries(query);
  }
}
