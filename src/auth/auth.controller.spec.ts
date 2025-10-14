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
    it('should return user, accessToken and refreshToken', async () => {
      console.log('🧪 Test: Starting login test - success case');


      const dto = { email: 'john.doe@example.com', password: 'secret12' };
      const user = { id: 'u_1', email: 'john.doe@example.com' } as any;
      const accessToken = 'access.token';
      const refreshToken = 'refresh.token';

      console.log('📞 Mocking authService.login to return success');
      authService.login.mockResolvedValue({ user, accessToken, refreshToken });

      console.log('🚀 Calling controller.login()');
      const result = await controller.login(dto as any);

      console.log('✅ Verifying expectations...');
      expect(authService.login).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ user, accessToken, refreshToken });
    });

    describe('refreshToken', () => {
      it('should read token from body and return new accessToken', async () => {
        const body: any = { refreshToken: 'valid.token' };

        jest.spyOn(authService, 'refreshToken').mockResolvedValue({ accessToken: 'new.access' });

        const result = await controller.refreshToken(body);

        expect(authService.refreshToken).toHaveBeenCalledWith('valid.token');
        expect(result).toEqual({ accessToken: 'new.access' });
      });
    });

    describe('profile', () => {
      it('should return user profile based on CurrentUser', async () => {
        const user: any = { userId: 'u_1' };
        const userProfile = { id: 'u_1', email: 'john.doe@example.com', role: 'PATIENT' } as any;

        jest.spyOn(authService, 'getUserById').mockResolvedValue(userProfile);

        const result = await controller.getProfile(user);

        expect(authService.getUserById).toHaveBeenCalledWith('u_1');
        expect(result).toEqual(userProfile);
      });
    });

    it('should rethrow service errors (e.g., UnauthorizedException)', async () => {
      const dto = { email: 'bad.user@example.com', password: 'wrong' };
      authService.login.mockRejectedValue(new UnauthorizedException('Invalid credentials'));

      await expect(controller.login(dto as any)).rejects.toBeInstanceOf(UnauthorizedException);
    });
    console.log('🎉 Test completed successfully');
  });
});
