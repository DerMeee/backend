import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateMessageDto {
  @ApiProperty({
    description:
      'Message ID (required for WebSocket, ignored for REST - uses URL param)',
    example: 'cmgscuyjw0004uggovqk7ildx',
    required: false,
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({
    description: 'Updated message content',
    example: 'Updated message content',
    required: false,
  })
  @IsOptional()
  @IsString()
  content?: string;
}
