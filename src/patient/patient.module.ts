import { Module } from '@nestjs/common';
import { PatientController } from './patient.controller';
import { PatientService } from './patient.service';
import { PatientRoleGuard } from './patient-role.guard';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PatientController],
  providers: [PatientService, PatientRoleGuard],
  exports: [PatientService],
})
export class PatientModule {}
