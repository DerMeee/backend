import { ApiProperty } from '@nestjs/swagger';

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
}
