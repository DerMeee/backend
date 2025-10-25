import { ApiProperty } from '@nestjs/swagger';

export class DoctorResponseDto {
  @ApiProperty({ description: 'Unique identifier for the doctor' })
  id: string;

  @ApiProperty({ description: 'Doctor\'s full name' })
  name: string;

  @ApiProperty({ description: 'Doctor\'s email address' })
  email: string;

  @ApiProperty({ description: 'User role (always DOCTOR for this endpoint)', enum: ['DOCTOR'] })
  role: string;

  @ApiProperty({ description: 'Account creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;
}
