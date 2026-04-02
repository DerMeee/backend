import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Request,
  UnauthorizedException,
} from '@nestjs/common';
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

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(loginData: LoginDto): Promise<LoginResponseDto> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email: loginData.email },
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
      const tokens = this.generateTokens(user);
      const { passwordHash: _passwordHash, ...result } = user as any;
      return { user: result, ...tokens };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Internal Error:', error.message);
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

      const accessToken = this.generateAccessToken(user);
      return { accessToken };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Internal Error:', error.message);
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

      const user = await this.prisma.$transaction(async (tx) => {
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
            name: data.name,
            email: data.email,
            phoneNumber: data.phoneNumber,
            passwordHash: hashed,
            role: (data.role ?? SignupRole.PATIENT) as any,
            addressId: address?.id,
          },
        });

        if ((data.role ?? SignupRole.PATIENT) === SignupRole.DOCTOR) {
          await tx.doctor.create({
            data: {
              userId: createdUser.id,
              fees: data.fees ?? 0,
              workYears: data.workYears ?? 0,
              about: data.about,
            },
          });
        } else {
          await tx.patient.create({
            data: {
              userId: createdUser.id,
            },
          });
        }
        console.log('Created User:', createdUser);

        const tokens = this.generateTokens(createdUser);
        const { passwordHash: _passwordHash, ...safeUser } = createdUser as any;
        return { user: safeUser, ...tokens };
      });

      return user;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Internal Error:', error.message);
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
        user = await this.prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: {
              name: profile.name?.trim() || email.split('@')[0] || 'User',
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

      const tokens = this.generateTokens(user);
      const { passwordHash: _passwordHash, ...safeUser } = user as any;
      return { user: safeUser, ...tokens };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Internal Error:', error.message);
    }
  }

  async getUserById(userId: string): Promise<UserLoginResponseDto> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { address: true },
      });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      const { passwordHash: _passwordHash, ...safeUser } = user as any;
      return safeUser;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Internal Error:', error.message);
    }
  }

  private generateTokens(user: any) {
    return {
      accessToken: this.generateAccessToken(user),
      refreshToken: this.generateRefreshToken(user),
    };
  }
  private generateAccessToken(user: any): string {
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
  private generateRefreshToken(user: any): string {
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
