import { PartialType } from '@nestjs/swagger';
import { CreateDoctorDto } from './create-doctor.dto';
import { CreateWorkDayDto } from './create-work-day.dto';

export class UpdateDoctorDto extends PartialType(CreateWorkDayDto) {}
