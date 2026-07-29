import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUrl, ArrayMinSize } from 'class-validator';

export class AddProductImagesDto {
  @ApiProperty({
    type: [String],
    description: 'Image URLs to add to the product.',
    example: ['https://example.com/img1.png', 'https://example.com/img2.png'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUrl({}, { each: true })
  images: string[];
}
