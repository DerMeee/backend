import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Body for actions that must be justified (reject, suspend, cancel). */
export class RequiredReasonDto {
  @ApiProperty({
    example: 'License number could not be verified',
    minLength: 3,
    maxLength: 500,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

/** Body for actions where a note is optional (approve, reactivate). */
export class OptionalNoteDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
