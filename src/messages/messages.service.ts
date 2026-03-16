import {
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserPayload } from 'src/auth/dto/user-payload.dto';
import { Server } from 'socket.io';

@Injectable()
export class MessagesService {
  constructor(private prisma: PrismaService, private server: Server) {}
  async create(dto: CreateMessageDto, user: UserPayload) {
    try {
      console.log('body in service', dto);
      const message = await this.prisma.message.create({
        data: {
          content: dto.content,
          senderId: user.userId,
          receiverId: dto.receiverId,
        },
      });

      this.server.emit('message', message);

      console.log('message', message);
      return message;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Internal Error', error.message);
    }
  }

  async findAll(receiverId: string, user: UserPayload) {
    try {
      const limit = 50;
      const messages = await this.prisma.message.findMany({
        where: {
          OR: [
            { senderId: user.userId, receiverId: receiverId },
            { senderId: receiverId, receiverId: user.userId },
          ],
        },
        orderBy: {
          createdAt: 'asc',
        },
        take: limit,
      });
      console.log('messages', messages);

      this.server.emit('messages', messages);

      return messages;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Internal Error', error.message);
    }
  }

  async findOne(id: string) {
    try {
      const message = await this.prisma.message.findUnique({
        where: { id },
      });
      if (!message) {
        throw new NotFoundException('Message not found');
      }
      this.server.emit('message', message);
      return message;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Internal Error', error.message);
    }
  }

  async update(
    id: string,
    updateMessageDto: UpdateMessageDto,
    user: UserPayload,
  ) {
    try {
      const message = await this.prisma.message.findUnique({
        where: { id },
      });
      if (!message) {
        throw new NotFoundException('Message not found');
      }
      if (message.senderId !== user.userId) {
        throw new ForbiddenException('You can only update your own messages');
      }
      const data: { content?: string } = {};
      if (updateMessageDto.content !== undefined) {
        data.content = updateMessageDto.content;
      }
      if (Object.keys(data).length === 0) {
        return message;
      }
      const updated = await this.prisma.message.update({
        where: { id },
        data,
      });
      this.server.emit('message', updated);
      return updated;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Internal Error', error.message);
    }
  }

  async remove(id: string, user: UserPayload) {
    try {
      const message = await this.prisma.message.findUnique({
        where: { id },
      });
      if (!message) {
        throw new NotFoundException('Message not found');
      }
      if (message.senderId !== user.userId) {
        throw new ForbiddenException('You can only delete your own messages');
      }
      await this.prisma.message.delete({
        where: { id },
      });
      this.server.emit('message', { message: 'Message deleted successfully' });
      return { message: 'Message deleted successfully' };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Internal Error', error.message);
    }
  }
}
