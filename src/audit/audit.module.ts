import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { SettingsService } from '../settings/settings.service';
import { SettingsController } from '../settings/settings.controller';

/** Global: audit logging and settings are used by almost every feature module. */
@Global()
@Module({
  controllers: [AuditController, SettingsController],
  providers: [AuditService, SettingsService],
  exports: [AuditService, SettingsService],
})
export class AuditModule {}
