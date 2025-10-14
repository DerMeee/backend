import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';


// this to fix merge conflict issue
describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;

  beforeEach(async () => {
    const authServiceMock: Partial<jest.Mocked<AuthService>> = {
      login: jest.fn(),
      refreshToken: jest.fn(),
      getUserById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get(AuthService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('login', () => {
    it('should return user and accessToken and set refresh_token cookie', async () => {
      console.log('🧪 Test: Starting login test - success case');


      const dto = { username: 'john.doe', password: 'secret12' };
      const user = { ID: 1, UserName: 'john.doe' } as any;
      const accessToken = 'access.token';
      const refreshToken = 'refresh.token';

      console.log('📞 Mocking authService.login to return success');
      authService.login.mockResolvedValue({ user, accessToken, refreshToken });

      console.log('📨 Preparing mock response object', user, accessToken, refreshToken);
      const cookie = jest.fn();
      const res: any = { cookie };

      console.log('🚀 Calling controller.login()');
      const result = await controller.login(dto as any, res);

      console.log('✅ Verifying expectations...');
      expect(authService.login).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ user, accessToken });

      expect(cookie).toHaveBeenCalledWith(
        'refresh_token',
        refreshToken,
        expect.objectContaining({
          httpOnly: false,
          sameSite: 'lax',
          path: '/',
        }),
      );
    });

    describe('refreshToken', () => {
      it('should read cookie, call service, and return new accessToken', async () => {
        const req: any = { cookies: { refresh_token: 'valid.token' } };
        const res: any = { cookie: jest.fn() };
  
        jest.spyOn(authService, 'refreshToken').mockResolvedValue({ accessToken: 'new.access' });
  
        const result = await controller.refreshToken(req, res);
  
        expect(authService.refreshToken).toHaveBeenCalledWith('valid.token');
        expect(result).toEqual({ accessToken: 'new.access' });
      });
    });

    describe('profile', () => {
      it('should return user profile based on CurrentUser', async () => {
        const user: any = { username: 'john.doe' };
        const userProfile = { ID: 1, UserName: 'john.doe', TYPE: 1 } as any;

        jest.spyOn(authService, 'getUserById').mockResolvedValue(userProfile);

        const result = await controller.getProfile(user);

        expect(authService.getUserById).toHaveBeenCalledWith('john.doe');
        expect(result).toEqual(userProfile);
      });
    });

    it('should rethrow service errors (e.g., UnauthorizedException)', async () => {
      const dto = { username: 'bad.user', password: 'wrong' };
      authService.login.mockRejectedValue(new UnauthorizedException('Invalid credentials'));

      const res: any = { cookie: jest.fn() };

      await expect(controller.login(dto as any, res)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(res.cookie).not.toHaveBeenCalled();
    });
    console.log('🎉 Test completed successfully');
  });
});
