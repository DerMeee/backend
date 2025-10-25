import { ApiProperty } from '@nestjs/swagger';

export class DoctorLeaveResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the leave record',
    example: 'clx1234567890abcdef',
  })
  id: string;

  @ApiProperty({
    description: 'Doctor ID',
    example: 'clx1234567890abcdef',
  })
  doctorId: string;

  @ApiProperty({
    description: 'Start date of the leave period',
    example: '2024-10-20T00:00:00.000Z',
  })
  startDate: Date;

  @ApiProperty({
    description: 'End date of the leave period',
    example: '2024-10-27T00:00:00.000Z',
  })
  endDate: Date;

  @ApiProperty({
    description: 'Reason for the leave',
    example: 'Annual vacation',
  })
  reason: string;

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2024-01-15T10:30:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2024-01-15T10:30:00.000Z',
  })
  updatedAt: Date;
}
