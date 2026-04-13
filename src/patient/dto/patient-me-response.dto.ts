import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Nested user fields returned with GET /patients/me */
export class PatientMeUserDto {
  @ApiProperty({ example: 'Jane Doe' })
  name: string;

  @ApiProperty({ example: 'jane@example.com' })
  email: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Phone if set on the account',
    example: '+213555000000',
  })
  phoneNumber: string | null;
}

/** Response body for GET /patients/me */
export class PatientMeResponseDto {
  @ApiProperty({ description: 'Patient row id (domain id)' })
  id: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Public URL path to the profile picture (stored on User), or null if none',
    example: '/uploads/profile-pictures/clxxx/profile.jpg',
  })
  profilePictureUrl: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: PatientMeUserDto })
  user: PatientMeUserDto;
}
