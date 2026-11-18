import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ImpersonationService } from './impersonation.service';
import {
  AdminImpersonationController,
  ImpersonationController,
} from './impersonation.controller';
import { ImpersonationReadOnlyGuard } from './impersonation-read-only.guard';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AdminImpersonationController, ImpersonationController],
  providers: [
    ImpersonationService,
    // Applies to every HTTP route: impersonation tokens can only read.
    { provide: APP_GUARD, useClass: ImpersonationReadOnlyGuard },
  ],
  exports: [ImpersonationService],
})
export class ImpersonationModule {}
