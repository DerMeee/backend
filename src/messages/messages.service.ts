import {
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserPayload } from 'src/auth/dto/user-payload.dto';

@Injectable()
export class MessagesService {
  constructor(private prisma: PrismaService) {}
  async create(dto: CreateMessageDto, user: UserPayload) {
    try {
      console.log("body in service", dto);
      const message = await this.prisma.message.create({
        data: {
          content: dto.content,
          senderId: user.userId,
          receiverId: dto.receiverId,
        },
      });

      console.log("message", message)
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
      console.log("messages", messages)

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
      const message = this.prisma.message.findUnique({
        where: { id: id },
      });
      if (!message) {
        throw new NotFoundException('Message not found');
      }
      return message;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Internal Error', error.message);
    }
  }

  update(id: number, updateMessageDto: UpdateMessageDto) {
    return `This action updates a #${id} message`;
  }

  remove(id: number) {
    return `This action removes a #${id} message`;
  }
}
