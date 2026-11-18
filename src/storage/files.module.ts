import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { PatientModule } from '../patient/patient.module';

@Module({
  imports: [PatientModule],
  controllers: [FilesController],
})
export class FilesModule {}
