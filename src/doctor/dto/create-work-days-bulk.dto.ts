import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
import { CreateWorkDayDto } from './create-work-day.dto';

export class CreateWorkDaysBulkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateWorkDayDto)
  @ApiProperty({ type: [CreateWorkDayDto] })
  days: CreateWorkDayDto[];
}
