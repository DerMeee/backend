import { ApiProperty } from '@nestjs/swagger';

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
}
