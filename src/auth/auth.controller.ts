import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  Res,
  Req,
  InternalServerErrorException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  LoginDto,
  LoginResponseDto,
  RefreshTokenResponseDto,
  UserLoginResponseDto,
  RefreshTokenRequestDto,
} from './dto/login.dto';
import { SignupDto, SignupResponseDto } from './dto/signup.dto';
import { JwtAuthGuard } from './guards/jwt-aut.guard';
import type { Response, Request } from 'express';
import { CurrentUser } from './decorator/current-user.decorator';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @ApiResponse({
    status: 200,
    description: 'User logged in successfully',
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
  async login(
    @Body() loginData: LoginDto,
  ) {
    try {
      const { user, accessToken, refreshToken } =
        await this.authService.login(loginData);
      return { user, accessToken, refreshToken }; // Return tokens for frontend use
    } catch (error) {
      // Re-throw the original exception to preserve the correct status code
      throw error;
    }
  }

  @ApiResponse({
    status: 201,
    description: 'User signed up successfully',
    type: SignupResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiResponse({ status: 500, description: 'Internal Server Error' })
  @Post('signup')
  async signup(
    @Body() data: SignupDto,
  ) {
    try {
      const { accessToken, refreshToken, user } =
        await this.authService.signup(data);
      return { user, accessToken, refreshToken };
    } catch (error) {
      throw new InternalServerErrorException(error);
    }
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
  async refreshToken(
    @Body() body: RefreshTokenRequestDto,
  ) {
    try {
      const { refreshToken } = body;
      const { accessToken } = await this.authService.refreshToken(refreshToken);

      return { accessToken };
    } catch (error) {
      // Re-throw the original exception to preserve the correct status code
      throw error;
    }
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
    try {
      return await this.authService.getUserById(user.userId);
    } catch (error) {
      // Re-throw the original exception to preserve the correct status code
      throw error;
    }
  }
}
