import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import {
  LoginDto,
  LoginResponseDto,
  RefreshTokenResponseDto,
  UserLoginResponseDto,
  RefreshTokenRequestDto,
  PatientLoginProfileDto,
  DoctorLoginProfileDto,
} from './dto/login.dto';
import { SignupDto, SignupResponseDto } from './dto/signup.dto';
import { JwtAuthGuard } from './guards/jwt-aut.guard';
import type { Request, Response } from 'express';
import type { OAuthUserProfile } from './types/oauth-profile.type';
import { CurrentUser } from './decorator/current-user.decorator';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

@ApiExtraModels(PatientLoginProfileDto, DoctorLoginProfileDto)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @ApiResponse({
    status: 200,
    description:
      'User logged in successfully. `user.patient` is set when role is PATIENT; `user.doctor` when role is DOCTOR.',
    type: LoginResponseDto,
    headers: {
      'Set-Cookie': {
        description:
          'Contains refresh_token cookie for subsequent token refresh',
        schema: {
          type: 'string',
          example:
            'refresh_token=eyJhbGciOi...; Path=/; Max-Age=604800; SameSite=lax',
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiResponse({ status: 500, description: 'Internal Server Error' })
  @Post('login')
  login(@Body() loginData: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(loginData);
  }

  @ApiResponse({
    status: 201,
    description: 'User signed up successfully',
    type: SignupResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiResponse({ status: 500, description: 'Internal Server Error' })
  @Post('signup')
  signup(@Body() data: SignupDto): Promise<LoginResponseDto> {
    return this.authService.signup(data);
    // try {
    //   const { accessToken, refreshToken, user } =
    //     await this.authService.signup(data);
    //   return { user, accessToken, refreshToken };
    // } catch (error) {
    //   throw new InternalServerErrorException(error);
    // }
  }

  @ApiResponse({
    status: 201,
    description: 'refresh token successful',
    type: RefreshTokenResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Invalid token/Missing token' })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiResponse({ status: 500, description: 'Internal Server Error' })
  @Post('refresh-token')
  refreshToken(@Body() body: RefreshTokenRequestDto) {
    return this.authService.refreshToken(body);
  }

  @ApiBearerAuth()
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
    type: UserLoginResponseDto,
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiResponse({ status: 500, description: 'Internal Server Error' })
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@CurrentUser() user: any) {
    return this.authService.getUserById(user.userId);
  }

  /** Starts the Google OAuth2 redirect flow (browser). */
  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth(): void {
    /* Passport redirects */
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthCallback(
    @Req() req: Request & { user: OAuthUserProfile },
    @Res() res: Response,
  ): Promise<void> {
    const data = await this.authService.oauthLogin(req.user);
    this.redirectWithTokens(res, data);
  }

  @Get('facebook')
  @UseGuards(AuthGuard('facebook'))
  facebookAuth(): void {
    /* Passport redirects */
  }

  @Get('facebook/callback')
  @UseGuards(AuthGuard('facebook'))
  async facebookAuthCallback(
    @Req() req: Request & { user: OAuthUserProfile },
    @Res() res: Response,
  ): Promise<void> {
    const data = await this.authService.oauthLogin(req.user);
    this.redirectWithTokens(res, data);
  }

  private redirectWithTokens(
    res: Response,
    data: LoginResponseDto,
  ): void {
    const base = this.configService.getOrThrow<string>('OAUTH_SUCCESS_REDIRECT');
    const url = new URL(base);
    url.searchParams.set('accessToken', data.accessToken);
    url.searchParams.set('refreshToken', data.refreshToken);
    res.redirect(url.toString());
  }
}
