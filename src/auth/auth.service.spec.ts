import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: jest.Mocked<PrismaService>;
  let jwt: jest.Mocked<JwtService>;
  let config: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const prismaMock: Partial<jest.Mocked<PrismaService>> = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      } as any,
      address: {
        create: jest.fn(),
      } as any,
      doctor: {
        create: jest.fn(),
      } as any,
      patient: {
        create: jest.fn(),
      } as any,
      $transaction: jest.fn((fn: any) => fn(prismaMock)),
    } as any;

    const jwtMock: Partial<jest.Mocked<JwtService>> = {
      sign: jest.fn().mockReturnValue('token'),
      verify: jest.fn().mockReturnValue({ userId: 'u_1', role: 'PATIENT' }),
    };

    const configMock: Partial<jest.Mocked<ConfigService>> = {
      get: jest.fn((key: string) => (key.includes('REFRESH_SECRET') || key.includes('JWT_SECRET') ? 'JWT_SECRET' : undefined)) as any,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: JwtService, useValue: jwtMock },
        { provide: ConfigService, useValue: configMock },
        
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get(PrismaService) as any;
    jwt = module.get(JwtService) as any;
    config = module.get(ConfigService) as any;

    jest.spyOn(require('bcrypt'), 'compare').mockResolvedValue(true as any);
    jest.spyOn(require('bcrypt'), 'hash').mockResolvedValue('hash' as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    it('returns user and tokens when credentials are valid', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u_1', email: 'john.doe@example.com', passwordHash: 'hash', role: 'PATIENT' });

      const result = await service.login({ email: 'john.doe@example.com', password: 'pw' } as any);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'john.doe@example.com' } });
      expect(result.accessToken).toBe('token');
      expect(result.refreshToken).toBe('token');
      expect(result.user).toMatchObject({ id: 'u_1', email: 'john.doe@example.com' });
    });

    it('throws Unauthorized when user not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.login({ email: 'nope@example.com', password: 'pw' } as any)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('refreshToken', () => {
    it('returns new access token when refresh token is valid', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u_1', email: 'john.doe@example.com', passwordHash: 'hash', role: 'PATIENT' });

      const result = await service.refreshToken('valid.token');

      expect(jwt.verify).toHaveBeenCalledWith('valid.token', { secret: 'JWT_SECRET' });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u_1' } });
      expect(result.accessToken).toBe('token');
      expect(result.accessToken).toBe('token');
    });

    it('throws Unauthorized when refresh token is invalid', async () => {
      jwt.verify.mockImplementationOnce(() => {
        throw new Error('Invalid token');
      });
      await expect(service.refreshToken('bad.token')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('profile', () => {
    it('returns user profile without password', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u_1', email: 'john.doe@example.com', passwordHash: 'hash', role: 'PATIENT' });

      const result = await service.getUserById('u_1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u_1' }, include: { address: true } });
      expect(result).toMatchObject({ id: 'u_1', email: 'john.doe@example.com' });
      expect((result as any).passwordHash).toBeUndefined();
    });

    it('throws NotFound when user not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.getUserById('u_missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
