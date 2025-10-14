import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength, IsNumber, IsInt } from 'class-validator';

export enum SignupRole {
  PATIENT = 'PATIENT',
  DOCTOR = 'DOCTOR',
}

export class SignupDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  @ApiProperty({ example: 'John Doe' })
  name: string;

  @IsEmail({}, { message: 'invalid email format' })
  @MaxLength(50, { message: 'email can not be longer than 50 charaters' })
  @MinLength(6, { message: 'email must be at least 6 characters long' })
  @ApiProperty({ example: 'john@example.com' })
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @ApiPropertyOptional({ example: '+213555000111' })
  phoneNumber?: string;

  @IsNotEmpty()
  @MinLength(6, { message: 'password must be at least 6 characters long' })
  @MaxLength(50, { message: 'password can not be longer than 50 charaters' })
  @ApiProperty({ example: 'P@ssw0rd!' })
  password: string;

  @IsOptional()
  @IsEnum(SignupRole)
  @ApiPropertyOptional({ enum: SignupRole, default: SignupRole.PATIENT })
  role?: SignupRole;

  // Optional address
  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  street?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  city?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  state?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  postalCode?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  country?: string;

  // Doctor-only fields
  @IsOptional()
  @IsNumber()
  @ApiPropertyOptional({ example: 1500 })
  fees?: number;

  @IsOptional()
  @IsInt()
  @ApiPropertyOptional({ example: 5 })
  workYears?: number;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'Dermatologist with focus on aesthetics' })
  about?: string;
}

export class SignupResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;
}


