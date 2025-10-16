import { ApiProperty } from "@nestjs/swagger";
import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateAppointmentDto {
  // Doctor's User ID (we'll resolve to Doctor.id internally)
  @IsNotEmpty()
  @IsString()
  @ApiProperty()
  doctorUserId: string;

  @IsNotEmpty()
  @IsDateString()
  @ApiProperty()
  // Date in YYYY-MM-DD
  date: Date;

  @IsNotEmpty()
  @IsString()
  @ApiProperty()
  // Time in HH:mm (24h)
  time: string;

  @IsNotEmpty()
  @IsInt()
  @ApiProperty()
  // Optional duration in minutes
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  @ApiProperty()
  // Optional appointment type/label
  type?: string;
}
