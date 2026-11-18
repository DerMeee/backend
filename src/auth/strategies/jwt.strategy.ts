import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import type { RequestUser } from '../../common/request-user';
import { ACCOUNT_SUSPENDED_MESSAGE } from '../auth.service';
import { ImpersonationService } from '../../impersonation/impersonation.service';

/** Bearer header first, then the `access_token` cookie. Shared with the impersonation guard. */
export const extractAccessToken = ExtractJwt.fromExtractors([
  ExtractJwt.fromAuthHeaderAsBearerToken(),
  (request: Request) => request?.cookies?.access_token ?? null,
]);

/** lastActivityAt is written at most this often per user. */
const ACTIVITY_WRITE_INTERVAL_MS = 5 * 60 * 1000;

export interface AccessTokenPayload {
  userId: string;
  role: string;
  /** Present only on read-only impersonation tokens. */
  imp?: { sid: string; by: string };
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly impersonation: ImpersonationService,
    configService: ConfigService,
  ) {
    super({
      jwtFromRequest: extractAccessToken,
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || '',
    });
  }

  /** Runs on every authenticated request: the account must still exist and be active. */
  async validate(payload: AccessTokenPayload): Promise<RequestUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        role: true,
        email: true,
        status: true,
        lastActivityAt: true,
      },
    });
    if (!user) throw new UnauthorizedException('Invalid token');
    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException(ACCOUNT_SUSPENDED_MESSAGE);
    }

    if (payload.imp) {
      // Read-only impersonation: valid only while the session is open and its admin is
      // still an active ADMIN. Permissions are those of the target user (role below).
      const ok = await this.impersonation.assertActive(
        payload.imp.sid,
        payload.imp.by,
        user.id,
      );
      if (!ok)
        throw new UnauthorizedException('Impersonation session has ended');
      return {
        id: user.id,
        userId: user.id,
        role: user.role,
        email: user.email,
        impersonatorId: payload.imp.by,
        impersonationSessionId: payload.imp.sid,
      };
    }

    this.touchActivity(user.id, user.lastActivityAt);

    return {
      id: user.id,
      userId: user.id,
      role: user.role,
      email: user.email,
    };
  }

  /** Fire-and-forget; the conditional update keeps concurrent requests from writing twice. */
  private touchActivity(userId: string, last: Date | null) {
    const threshold = new Date(Date.now() - ACTIVITY_WRITE_INTERVAL_MS);
    if (last && last > threshold) return;
    this.prisma.user
      .updateMany({
        where: {
          id: userId,
          OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: threshold } }],
        },
        data: { lastActivityAt: new Date() },
      })
      .catch((e: unknown) =>
        this.logger.warn(
          `lastActivityAt update failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
  }
}
