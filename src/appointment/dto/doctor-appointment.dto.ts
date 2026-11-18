import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DoctorAppointmentDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  date: string;

  @ApiProperty()
  time: string;

  @ApiProperty()
  patient: string;

  @ApiProperty()
  state: string;

  @ApiProperty()
  type: string;

  @ApiProperty({
    example: 'RSV-000123',
    description: 'Human-friendly reservation reference',
  })
  reference: string;

  @ApiPropertyOptional({ enum: ['ONLINE', 'ONSITE'] })
  visitMode?: string;
}
