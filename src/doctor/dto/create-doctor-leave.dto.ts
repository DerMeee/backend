import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsString } from 'class-validator';

export class CreateDoctorLeaveDto {
  @ApiProperty({
    description: 'Start date of the leave period',
    example: '2024-10-20',
    type: 'string',
    format: 'date',
  })
  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @ApiProperty({
    description: 'End date of the leave period',
    example: '2024-10-27',
    type: 'string',
    format: 'date',
  })
  @IsDateString()
  @IsNotEmpty()
  endDate: string;

  @ApiProperty({
    description: 'Reason for the leave',
    example: 'Annual vacation',
  })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
