import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateRatingDto {
  @ApiProperty({ example: 4, description: 'Rating score between 1 and 5' })
  @IsInt()
  @Min(1)
  @Max(5)
  score: number;

  @ApiProperty({ required: false, example: 'Great product, very effective!' })
  @IsOptional()
  @IsString()
  review?: string;
}
