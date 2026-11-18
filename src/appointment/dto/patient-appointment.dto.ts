import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PatientAppointmentDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  date: string;

  @ApiProperty()
  time: string;

  @ApiProperty()
  doctor: string;

  @ApiProperty()
  status: string;

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
