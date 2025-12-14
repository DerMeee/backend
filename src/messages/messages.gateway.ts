import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { CurrentUser } from 'src/auth/decorator/current-user.decorator';
import { UserPayload } from 'src/auth/dto/user-payload.dto';
import { LoggingMiddleware } from 'src/middlewares/logging.middleware';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import { Logger } from '@nestjs/common';

@WebSocketGateway()
export class MessagesGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private logger = new Logger();
  server: Server;
  constructor(
    private jwtService: JwtService,
    private messagesService: MessagesService,
    private prisma: PrismaService,
  ) {}

  afterInit(server: Server) {
    this.server = server;
    this.logger.log('Gateway initialized');
  }
  async handleConnection(client: Socket) {
    try {
      // Extract token from handshake auth (client can send { token: '...' }) or headers
      const token =
        client.handshake.auth?.token || this.extractTokenFromHeaders(client);
      if (!token) {
        client.disconnect(true);
        return;
      }
      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET,
      });
      // Attach user info to socket
      client.data.user = { userId: payload.userId, role: payload.role };

      // Optionally: add to room for direct messages by user id
      client.join(this.getRoomName(payload.userId)); 
      this.logger.log(
        `Client connected: user ${payload.userId} socket ${client.id}`,
      );
    } catch (err) {
      this.logger.warn(
        'Unauthorized socket connection attempt: ' + err.message,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected ${client.id}`);
  }

  private getRoomName(userId: string) {
    return `user:${userId}`;
  }

  private extractTokenFromHeaders(client: Socket): string | null {
    const authHeader = client.handshake.headers?.authorization as
      | string
      | undefined;
    if (!authHeader) return null;
    const parts = authHeader.split(' ');
    if (parts.length === 2 && /^Bearer$/i.test(parts[0])) return parts[1];
    return null;
  }

  @SubscribeMessage('createMessage')
  create(
    @MessageBody() createMessageDto: CreateMessageDto,
    @CurrentUser() user: UserPayload,
  ) {
    return this.messagesService.create(createMessageDto, user);
  }

  @SubscribeMessage('findAllMessages')
  findAll(@MessageBody() receiverId: string, @CurrentUser() user: UserPayload) {
    return this.messagesService.findAll(receiverId, user);
  }

  @SubscribeMessage('findOneMessage')
  findOne(@MessageBody() id: string) {
    return this.messagesService.findOne(id);
  }

  @SubscribeMessage('updateMessage')
  update(@MessageBody() updateMessageDto: UpdateMessageDto) {
    return this.messagesService.update(updateMessageDto.id, updateMessageDto);
  }

  @SubscribeMessage('removeMessage')
  remove(@MessageBody() id: number) {
    return this.messagesService.remove(id);
  }
}
