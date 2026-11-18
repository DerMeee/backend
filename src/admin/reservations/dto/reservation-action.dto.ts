import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ReservationActionDto {
  @ApiPropertyOptional({ maxLength: 500, description: 'Required for cancel' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AdminNoteDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;
}
