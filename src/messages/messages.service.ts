import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { catchServiceError } from '../utils/catch-service-error';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserPayload } from 'src/auth/dto/user-payload.dto';
import { RealtimeService } from '../realtime/realtime.service';

/**
 * Socket events go only to the two people in the conversation (their `user:<id>` rooms),
 * never to every connected client.
 */
@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async create(dto: CreateMessageDto, user: UserPayload) {
    try {
      const message = await this.prisma.message.create({
        data: {
          content: dto.content,
          senderId: user.userId,
          receiverId: dto.receiverId,
        },
      });
      this.realtime.emitToUsers(
        [message.senderId, message.receiverId],
        'message',
        message,
      );
      return message;
    } catch (error) {
      catchServiceError(error);
    }
  }

  /** Last 50 messages between the current user and `receiverId`. */
  async findAll(receiverId: string, user: UserPayload) {
    try {
      const limit = 50;
      // Newest 50, returned oldest-first for display.
      const latest = await this.prisma.message.findMany({
        where: {
          OR: [
            { senderId: user.userId, receiverId: receiverId },
            { senderId: receiverId, receiverId: user.userId },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      const messages = latest.reverse();
      this.realtime.emitToUser(user.userId, 'messages', messages);
      return messages;
    } catch (error) {
      catchServiceError(error);
    }
  }

  /** One entry per person the user has exchanged messages with, newest conversation first. */
  async conversations(user: UserPayload) {
    try {
      const rows = await this.prisma.$queryRaw<
        {
          otherId: string;
          id: string;
          content: string;
          senderId: string;
          createdAt: Date;
        }[]
      >`
        SELECT DISTINCT ON ("otherId") "otherId", "id", "content", "senderId", "createdAt"
        FROM (
          SELECT CASE WHEN "senderId" = ${user.userId} THEN "receiverId" ELSE "senderId" END AS "otherId",
                 "id", "content", "senderId", "createdAt"
          FROM "Message"
          WHERE "senderId" = ${user.userId} OR "receiverId" = ${user.userId}
        ) m
        ORDER BY "otherId", "createdAt" DESC
        LIMIT 200`;
      const people = rows.length
        ? await this.prisma.user.findMany({
            where: { id: { in: rows.map((r) => r.otherId) } },
            select: {
              id: true,
              name: true,
              role: true,
              profilePictureUrl: true,
            },
          })
        : [];
      return rows
        .map((r) => ({
          user: people.find((p) => p.id === r.otherId) ?? {
            id: r.otherId,
            name: '—',
            role: null,
            profilePictureUrl: null,
          },
          lastMessage: {
            id: r.id,
            content: r.content,
            fromMe: r.senderId === user.userId,
            createdAt: r.createdAt,
          },
        }))
        .sort(
          (a, b) =>
            b.lastMessage.createdAt.getTime() -
            a.lastMessage.createdAt.getTime(),
        );
    } catch (error) {
      catchServiceError(error);
    }
  }

  async findOne(id: string, user: UserPayload) {
    try {
      const message = await this.prisma.message.findUnique({
        where: { id },
      });
      if (!message) {
        throw new NotFoundException('Message not found');
      }
      if (
        message.senderId !== user.userId &&
        message.receiverId !== user.userId
      ) {
        throw new ForbiddenException(
          'You can only read your own conversations',
        );
      }
      this.realtime.emitToUser(user.userId, 'message', message);
      return message;
    } catch (error) {
      catchServiceError(error);
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
      this.realtime.emitToUsers(
        [updated.senderId, updated.receiverId],
        'message',
        updated,
      );
      return updated;
    } catch (error) {
      catchServiceError(error);
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
      this.realtime.emitToUsers(
        [message.senderId, message.receiverId],
        'messageDeleted',
        {
          id: message.id,
        },
      );
      return { message: 'Message deleted successfully' };
    } catch (error) {
      catchServiceError(error);
    }
  }
}
