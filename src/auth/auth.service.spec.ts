import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PermissionsService } from 'src/permissions/permissions.service';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: jest.Mocked<PrismaService>;
  let jwt: jest.Mocked<JwtService>;
  let config: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const prismaMock: Partial<jest.Mocked<PrismaService>> = {
      uSER: {
        findUnique: jest.fn(),
      } as any,
    };

    const jwtMock: Partial<jest.Mocked<JwtService>> = {
      sign: jest.fn().mockReturnValue('token'),
      verify: jest.fn().mockReturnValue({ username: 'john.doe', sub: 1, role: 1 }),
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
        { provide: PermissionsService, useValue: { getRolePermissions: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get(PrismaService) as any;
    jwt = module.get(JwtService) as any;
    config = module.get(ConfigService) as any;

    jest.spyOn(require('bcrypt'), 'compare').mockResolvedValue(true as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    it('returns user and tokens when credentials are valid', async () => {
      (prisma.uSER.findUnique as jest.Mock).mockResolvedValue({ ID: 1, UserName: 'john.doe', NEW_PASSWORD: 'hash', TYPE: 1 });

      const result = await service.login({ username: 'john.doe', password: 'pw' } as any);

      expect(prisma.uSER.findUnique).toHaveBeenCalledWith({ where: { UserName: 'john.doe' } });
      expect(result.accessToken).toBe('token');
      expect(result.refreshToken).toBe('token');
      expect(result.user).toMatchObject({ ID: 1, UserName: 'john.doe' });
    });

    it('throws Unauthorized when user not found', async () => {
      (prisma.uSER.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.login({ username: 'nope', password: 'pw' } as any)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('refreshToken', () => {
    it('returns new access token when refresh token is valid', async () => {
      (prisma.uSER.findUnique as jest.Mock).mockResolvedValue({ ID: 1, UserName: 'john.doe', NEW_PASSWORD: 'hash', TYPE: 1 });

      const result = await service.refreshToken('valid.token');

      expect(jwt.verify).toHaveBeenCalledWith('valid.token', { secret: 'JWT_SECRET' });
      expect(prisma.uSER.findUnique).toHaveBeenCalledWith({ where: { UserName: 'john.doe' } });
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
      (prisma.uSER.findUnique as jest.Mock).mockResolvedValue({ ID: 1, UserName: 'john.doe', NEW_PASSWORD: 'hash', TYPE: 1 });

      const result = await service.getUserById('john.doe');

      expect(prisma.uSER.findUnique).toHaveBeenCalledWith({ where: { UserName: 'john.doe' } });
      expect(result).toMatchObject({ ID: 1, UserName: 'john.doe' });
      expect((result as any).NEW_PASSWORD).toBeUndefined();
    });

    it('throws NotFound when user not found', async () => {
      (prisma.uSER.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.getUserById('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
