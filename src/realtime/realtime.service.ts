import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

export const userRoom = (userId: string) => `user:${userId}`;

/**
 * Thin wrapper around the Socket.IO server so any service can push to a user
 * without depending on the gateway (avoids forwardRef cycles).
 * MessagesGateway registers the server once it is initialised.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  attach(server: Server) {
    this.server = server;
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server?.to(userRoom(userId)).emit(event, payload);
  }

  emitToUsers(userIds: string[], event: string, payload: unknown) {
    if (!this.server || userIds.length === 0) return;
    this.server.to(userIds.map(userRoom)).emit(event, payload);
  }

  /** Closes every open socket of a user (used when an account is suspended). */
  disconnectUser(userId: string) {
    if (!this.server) return;
    this.server.in(userRoom(userId)).disconnectSockets(true);
    this.logger.log(`Disconnected sockets of user ${userId}`);
  }
}
