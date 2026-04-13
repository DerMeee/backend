import { Module } from '@nestjs/common';
import { DoctorService } from './doctor.service';
import { DoctorController } from './doctor.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';
import { PatientModule } from '../patient/patient.module';

@Module({
  imports: [PrismaModule, AuthModule, PatientModule],
  controllers: [DoctorController],
  providers: [DoctorService],
})
export class DoctorModule {}
