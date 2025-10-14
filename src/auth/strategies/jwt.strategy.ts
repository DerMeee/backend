import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from '../auth.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private authService: AuthService,
    private readonly configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        // Extract from Authorization header (Bearer token)
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // Extract from HTTP-only cookie
        (request) => {
          return request?.cookies?.access_token;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || '',
    });
  }

  async validate(payload: any) {
    try {
      const user = await this.authService.getUserById(payload.userId);
      return {
        id: user.id,
        role: user.role,
        userId: user.id,
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
