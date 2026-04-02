import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type Profile } from 'passport-facebook';
import { ConfigService } from '@nestjs/config';
import type { OAuthUserProfile } from '../types/oauth-profile.type';

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  constructor(private readonly configService: ConfigService) {
    super({
      clientID: configService.getOrThrow<string>('OAUTH_FACEBOOK_APP_ID'),
      clientSecret: configService.getOrThrow<string>('OAUTH_FACEBOOK_APP_SECRET'),
      callbackURL: configService.getOrThrow<string>('OAUTH_FACEBOOK_CALLBACK_URL'),
      profileFields: ['id', 'displayName', 'photos', 'email'],
      scope: ['email'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ): OAuthUserProfile {
    const email = profile.emails?.[0]?.value;
    return {
      provider: 'facebook',
      providerId: profile.id,
      email,
      name: profile.displayName?.trim(),
    };
  }
}
