import { PartialType } from '@nestjs/swagger';
import { CreateWorkDayDto } from './create-work-day.dto';

export class UpdateDoctorDto extends PartialType(CreateWorkDayDto) {}
