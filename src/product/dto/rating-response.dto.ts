import { ApiProperty } from '@nestjs/swagger';

export class RatingResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  productId: string;

  @ApiProperty()
  patientId: string;

  @ApiProperty({ nullable: true })
  patientName: string | null;

  @ApiProperty({ example: 4 })
  score: number;

  @ApiProperty({ nullable: true })
  review: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
