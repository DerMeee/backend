import { ApiProperty } from '@nestjs/swagger';

export class GetSchedualExcepDto {
  @ApiProperty({type: String})
  id: string;

  @ApiProperty({type: String})
  doctorId: string;

  @ApiProperty()
  date: Date;

  @ApiProperty({type: String})
  type: string;

  @ApiProperty({type: String})
  start: string;

  @ApiProperty({type: String})
  end: string;

  @ApiProperty({type: String})
  reason: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
