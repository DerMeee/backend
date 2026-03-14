import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CreateMessageDto {
  @ApiProperty({
    description: 'Receiver user ID',
    example: 'cmgscuyjw0004uggovqk7ildx',
  })
  @IsString()
  receiverId: string;

  @ApiProperty({
    description: 'Message content',
    example: 'Hello, how are you?',
  })
  @IsString()
  content: string;
}
