import { ApiProperty } from '@nestjs/swagger';

export class MessageResponseDto {
  @ApiProperty({
    description: 'Message ID',
    example: 'cmgscuyjw0004uggovqk7ildx',
  })
  id: string;

  @ApiProperty({
    description: 'Message content',
    example: 'Hello, how are you?',
  })
  content: string;

  @ApiProperty({
    description: 'Sender user ID',
    example: 'cmgscuyjw0004uggovqk7ildx',
  })
  senderId: string;

  @ApiProperty({
    description: 'Receiver user ID',
    example: 'cmgscuyjw0004uggovqk7ildx',
  })
  receiverId: string;

  @ApiProperty({
    description: 'Message creation date',
    example: '2025-10-01T12:00:00.000Z',
  })
  createdAt: Date;
}
