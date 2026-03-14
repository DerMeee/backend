import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-aut.guard';
import { CurrentUser } from '../auth/decorator/current-user.decorator';
import { UserPayload } from '../auth/dto/user-payload.dto';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import { MessageResponseDto } from './dto/message-response.dto';

@ApiTags('messages')
@UseGuards(JwtAuthGuard)
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @ApiOperation({ summary: 'Create a new message' })
  @ApiBody({ type: CreateMessageDto })
  @ApiCreatedResponse({
    description: 'Message created successfully',
    type: MessageResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Bad Request - Invalid input' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiInternalServerErrorResponse({ description: 'Internal Server Error' })
  @Post()
  create(
    @Body() createMessageDto: CreateMessageDto,
    @CurrentUser() user: UserPayload,
  ) {
    return this.messagesService.create(createMessageDto, user);
  }

  @ApiOperation({ summary: 'Get messages between current user and a receiver' })
  @ApiQuery({
    name: 'receiverId',
    required: true,
    description: 'Receiver user ID to fetch conversation with',
    example: 'cmgscuyjw0004uggovqk7ildx',
  })
  @ApiOkResponse({
    description: 'Messages retrieved successfully',
    type: [MessageResponseDto],
  })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiInternalServerErrorResponse({ description: 'Internal Server Error' })
  @Get()
  findAll(
    @Query('receiverId') receiverId: string,
    @CurrentUser() user: UserPayload,
  ) {
    return this.messagesService.findAll(receiverId, user);
  }

  @ApiOperation({ summary: 'Get a single message by ID' })
  @ApiParam({
    name: 'id',
    description: 'Message ID',
    example: 'cmgscuyjw0004uggovqk7ildx',
  })
  @ApiOkResponse({
    description: 'Message retrieved successfully',
    type: MessageResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Message not found' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiInternalServerErrorResponse({ description: 'Internal Server Error' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.messagesService.findOne(id);
  }

  @ApiOperation({ summary: 'Update a message' })
  @ApiParam({
    name: 'id',
    description: 'Message ID',
    example: 'cmgscuyjw0004uggovqk7ildx',
  })
  @ApiBody({ type: UpdateMessageDto })
  @ApiOkResponse({
    description: 'Message updated successfully',
    type: MessageResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Bad Request - Invalid input' })
  @ApiNotFoundResponse({ description: 'Message not found' })
  @ApiForbiddenResponse({
    description: 'Forbidden - You can only update your own messages',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiInternalServerErrorResponse({ description: 'Internal Server Error' })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateMessageDto: UpdateMessageDto,
    @CurrentUser() user: UserPayload,
  ) {
    return this.messagesService.update(id, updateMessageDto, user);
  }

  @ApiOperation({ summary: 'Delete a message' })
  @ApiParam({
    name: 'id',
    description: 'Message ID',
    example: 'cmgscuyjw0004uggovqk7ildx',
  })
  @ApiOkResponse({
    description: 'Message deleted successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Message deleted successfully' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Message not found' })
  @ApiForbiddenResponse({
    description: 'Forbidden - You can only delete your own messages',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiInternalServerErrorResponse({ description: 'Internal Server Error' })
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: UserPayload) {
    return this.messagesService.remove(id, user);
  }
}
