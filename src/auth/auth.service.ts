import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { catchServiceError } from '../utils/catch-service-error';
import { PrismaService } from '../prisma/prisma.service';
import {
  LoginDto,
  LoginResponseDto,
  RefreshTokenRequestDto,
  UserLoginResponseDto,
} from './dto/login.dto';
import { SignupDto, SignupRole } from './dto/signup.dto';
import type { OAuthUserProfile } from './types/oauth-profile.type';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import { joinName, splitName } from '../common/names';
import {
  NotificationsService,
  NotificationType,
} from '../notifications/notifications.service';
import type { Notification } from '@prisma/client';

const userLoginInclude = {
  address: true,
  patientProfile: { select: { id: true, createdAt: true } },
  doctorProfile: {
    select: {
      id: true,
      fees: true,
      workYears: true,
      about: true,
      specialty: true,
      approvalStatus: true,
      rejectionReason: true,
    },
  },
} satisfies Prisma.UserInclude;

type UserWithLoginRelations = Prisma.UserGetPayload<{
  include: typeof userLoginInclude;
}>;

export const ACCOUNT_SUSPENDED_MESSAGE =
  'This account is suspended. Please contact Dermee support.';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  async login(loginData: LoginDto): Promise<LoginResponseDto> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email: loginData.email },
        include: userLoginInclude,
      });
      if (!user) {
        throw new UnauthorizedException('Invalid credentials');
      }
      if (!user.passwordHash) {
        throw new UnauthorizedException(
          'This account uses social login. Sign in with Google or Facebook.',
        );
      }
      const isPasswordValid = await bcrypt.compare(
        loginData.password,
        user.passwordHash,
      );
      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid credentials');
      }
      // Checked after the password so the response doesn't reveal account state to strangers.
      this.assertActive(user.status);
      const tokens = this.generateTokens(user);
      return {
        ...tokens,
        user: this.mapToLoginUser(user),
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async refreshToken(body: RefreshTokenRequestDto) {
    try {
      const { refreshToken } = body;
      const secret = this.configService.get<string>('REFRESH_SECRET');

      if (!secret) {
        throw new UnauthorizedException('Missing token');
      }
      let payload: { userId: string };
      try {
        payload = this.jwtService.verify<{ userId: string }>(refreshToken, {
          secret,
        });
      } catch {
        throw new UnauthorizedException('Invalid token');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.userId },
      });

      if (!user) {
        throw new UnauthorizedException('Invalid token');
      }
      // Refresh tokens are stateless, so suspension must be checked here too.
      if (user.status === UserStatus.SUSPENDED) {
        throw new UnauthorizedException(ACCOUNT_SUSPENDED_MESSAGE);
      }

      const accessToken = this.generateAccessToken(user);
      return { accessToken };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async signup(data: SignupDto): Promise<LoginResponseDto> {
    try {
      const existing = await this.prisma.user.findUnique({
        where: { email: data.email },
      });
      if (existing) {
        throw new ConflictException('Email already in use');
      }

      const hashed = await bcrypt.hash(data.password, 10);
      const role = data.role ?? SignupRole.PATIENT;
      const names =
        data.firstName || data.lastName
          ? {
              firstName: data.firstName?.trim() || null,
              lastName: data.lastName?.trim() || null,
            }
          : splitName(data.name);
      const displayName =
        data.name?.trim() || joinName(names.firstName, names.lastName);

      let adminAlerts: Notification[] = [];
      const userId = await this.prisma.$transaction(async (tx) => {
        const addressProvided = Boolean(
          data.street &&
            data.city &&
            data.state &&
            data.postalCode &&
            data.country,
        );
        const address = addressProvided
          ? await tx.address.create({
              data: {
                street: data.street!,
                city: data.city!,
                state: data.state!,
                postalCode: data.postalCode!,
                country: data.country!,
              },
            })
          : null;

        const createdUser = await tx.user.create({
          data: {
            name: displayName,
            firstName: names.firstName,
            lastName: names.lastName,
            email: data.email,
            phoneNumber: data.phoneNumber,
            passwordHash: hashed,
            role: role as UserRole,
            addressId: address?.id,
          },
        });

        if (role === SignupRole.DOCTOR) {
          // New doctors start PENDING: hidden from patients until an admin approves them.
          await tx.doctor.create({
            data: {
              userId: createdUser.id,
              fees: data.fees ?? 0,
              workYears: data.workYears ?? 0,
              about: data.about,
              specialty: data.specialty?.trim() || null,
            },
          });
          adminAlerts = await this.notifications.notifyAdmins(tx, {
            type: NotificationType.DOCTOR_PENDING_APPROVAL,
            content: `New doctor registration awaiting approval: ${displayName}`,
            entityType: 'User',
            entityId: createdUser.id,
            link: `/admin/doctors/${createdUser.id}`,
          });
        } else {
          await tx.patient.create({
            data: {
              userId: createdUser.id,
            },
          });
        }

        return createdUser.id;
      });

      this.notifications.publish(adminAlerts);
      return this.buildLoginResponse(userId);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async oauthLogin(profile: OAuthUserProfile): Promise<LoginResponseDto> {
    try {
      if (!profile.email?.trim()) {
        throw new BadRequestException(
          'Your social account did not provide an email. Enable email permission or use email/password login.',
        );
      }
      const email = profile.email.trim().toLowerCase();

      let user =
        profile.provider === 'google'
          ? await this.prisma.user.findUnique({
              where: { googleId: profile.providerId },
            })
          : await this.prisma.user.findUnique({
              where: { facebookId: profile.providerId },
            });

      if (!user) {
        const byEmail = await this.prisma.user.findUnique({
          where: { email },
        });
        if (byEmail) {
          user = await this.prisma.user.update({
            where: { id: byEmail.id },
            data:
              profile.provider === 'google'
                ? { googleId: profile.providerId }
                : { facebookId: profile.providerId },
          });
        }
      }

      if (!user) {
        const name = profile.name?.trim() || email.split('@')[0] || 'User';
        user = await this.prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: {
              name,
              ...splitName(name),
              email,
              passwordHash: null,
              googleId:
                profile.provider === 'google' ? profile.providerId : null,
              facebookId:
                profile.provider === 'facebook' ? profile.providerId : null,
            },
          });
          await tx.patient.create({ data: { userId: created.id } });
          return created;
        });
      }

      this.assertActive(user.status);
      return this.buildLoginResponse(user.id);
    } catch (error) {
      catchServiceError(error);
    }
  }

  async getUserById(userId: string): Promise<UserLoginResponseDto> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: userLoginInclude,
      });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      return this.mapToLoginUser(user);
    } catch (error) {
      catchServiceError(error);
    }
  }

  private assertActive(status: UserStatus) {
    if (status === UserStatus.SUSPENDED) {
      throw new ForbiddenException(ACCOUNT_SUSPENDED_MESSAGE);
    }
  }

  private async buildLoginResponse(userId: string): Promise<LoginResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: userLoginInclude,
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const tokens = this.generateTokens(user);
    return {
      ...tokens,
      user: this.mapToLoginUser(user),
    };
  }

  private mapToLoginUser(user: UserWithLoginRelations): UserLoginResponseDto {
    const address = user.address
      ? {
          id: user.address.id,
          street: user.address.street,
          city: user.address.city,
          state: user.address.state,
          postalCode: user.address.postalCode,
          country: user.address.country,
          validated: user.address.validated,
          createdAt: user.address.createdAt,
          updatedAt: user.address.updatedAt,
        }
      : undefined;

    return {
      id: user.id,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: user.role,
      status: user.status,
      profilePictureUrl: user.profilePictureUrl,
      address,
      patient:
        user.role === UserRole.PATIENT && user.patientProfile
          ? {
              id: user.patientProfile.id,
              createdAt: user.patientProfile.createdAt,
            }
          : undefined,
      doctor:
        user.role === UserRole.DOCTOR && user.doctorProfile
          ? {
              id: user.doctorProfile.id,
              fees: user.doctorProfile.fees,
              workYears: user.doctorProfile.workYears,
              about: user.doctorProfile.about,
              specialty: user.doctorProfile.specialty,
              approvalStatus: user.doctorProfile.approvalStatus,
              rejectionReason: user.doctorProfile.rejectionReason,
            }
          : undefined,
    };
  }

  private generateTokens(user: { id: string; role: UserRole }) {
    return {
      accessToken: this.generateAccessToken(user),
      refreshToken: this.generateRefreshToken(user),
    };
  }

  private generateAccessToken(user: { id: string; role: UserRole }): string {
    const payload = {
      userId: user.id,
      role: user.role,
    };
    const secret = this.configService.get<string>('JWT_SECRET');
    return this.jwtService.sign(payload, {
      secret,
      expiresIn: '15m',
    });
  }

  private generateRefreshToken(user: { id: string; role: UserRole }): string {
    const payload = {
      userId: user.id,
      role: user.role,
    };
    const secret = this.configService.get<string>('REFRESH_SECRET');
    return this.jwtService.sign(payload, {
      secret,
      expiresIn: '7d',
    });
  }
}
