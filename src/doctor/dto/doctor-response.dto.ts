import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DoctorResponseDto {
  @ApiProperty({ description: 'Unique identifier for the doctor (User.id)' })
  id: string;

  @ApiProperty({ description: "Doctor's full name" })
  name: string;

  @ApiProperty({ description: "Doctor's email address" })
  email: string;

  @ApiProperty({
    description: 'User role (always DOCTOR for this endpoint)',
    enum: ['DOCTOR'],
  })
  role: string;

  @ApiPropertyOptional({ nullable: true })
  specialty?: string | null;

  @ApiPropertyOptional({ description: 'Consultation fee (DZD)' })
  fees?: number;

  @ApiPropertyOptional()
  workYears?: number;

  @ApiPropertyOptional({ nullable: true })
  about?: string | null;

  @ApiPropertyOptional({ nullable: true })
  profilePictureUrl?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Practice wilaya' })
  wilaya?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Practice commune' })
  commune?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Practice street address',
  })
  street?: string | null;

  @ApiProperty({ description: 'Account creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;
}
