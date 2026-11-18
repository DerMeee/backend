import { Module } from '@nestjs/common';
import { DoctorService } from './doctor.service';
import { DoctorController } from './doctor.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';
import { PatientModule } from '../patient/patient.module';
import { DoctorDocumentsController } from './doctor-documents.controller';
import { DoctorRoleGuard } from './doctor-role.guard';

@Module({
  imports: [PrismaModule, AuthModule, PatientModule],
  // DoctorDocumentsController first: its /doctor/me/... routes must win over /doctor/:id.
  controllers: [DoctorDocumentsController, DoctorController],
  providers: [DoctorService, DoctorRoleGuard],
  exports: [DoctorService],
})
export class DoctorModule {}
