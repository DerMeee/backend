import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsException,
} from '@nestjs/websockets';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { CurrentUser } from 'src/auth/decorator/current-user.decorator';
import { UserPayload } from 'src/auth/dto/user-payload.dto';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import { Logger } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { RealtimeService, userRoom } from '../realtime/realtime.service';
import type { AccessTokenPayload } from '../auth/strategies/jwt.strategy';

/**
 * Chat + live notifications. Each socket joins `user:<id>`; services push to that room
 * through RealtimeService.
 */
@WebSocketGateway()
export class MessagesGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private logger = new Logger(MessagesGateway.name);
  server: Server;

  constructor(
    private jwtService: JwtService,
    private messagesService: MessagesService,
    private prisma: PrismaService,
    private realtime: RealtimeService,
  ) {}

  afterInit(server: Server) {
    this.server = server;
    this.realtime.attach(server);
    this.logger.log('Gateway initialized');
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token || this.extractTokenFromHeaders(client);
      if (!token) {
        client.disconnect(true);
        return;
      }
      const payload = this.jwtService.verify<AccessTokenPayload>(token, {
        secret: process.env.JWT_SECRET,
      });
      // Impersonation is read-only and HTTP-only: no chat sockets.
      if (payload.imp) {
        client.disconnect(true);
        return;
      }
      const user = await this.prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, role: true, status: true },
      });
      if (!user || user.status === UserStatus.SUSPENDED) {
        client.disconnect(true);
        return;
      }

      client.data.user = { userId: user.id, role: user.role };
      void client.join(userRoom(user.id));
      this.logger.log(`Client connected: user ${user.id} socket ${client.id}`);
    } catch (err) {
      this.logger.warn(
        'Unauthorized socket connection attempt: ' +
          (err instanceof Error ? err.message : String(err)),
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected ${client.id}`);
  }

  private extractTokenFromHeaders(client: Socket): string | null {
    const authHeader = client.handshake.headers?.authorization;
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
  findOne(@MessageBody() id: string, @CurrentUser() user: UserPayload) {
    return this.messagesService.findOne(id, user);
  }

  @SubscribeMessage('updateMessage')
  update(
    @MessageBody() updateMessageDto: UpdateMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    const user = client.data.user as UserPayload;
    const id = updateMessageDto.id;
    if (!id) {
      throw new WsException('Message id is required for update');
    }
    return this.messagesService.update(id, updateMessageDto, user);
  }

  @SubscribeMessage('removeMessage')
  remove(@MessageBody() id: string, @ConnectedSocket() client: Socket) {
    const user = client.data.user as UserPayload;
    return this.messagesService.remove(id, user);
  }
}
