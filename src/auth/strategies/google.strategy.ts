import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import type { OAuthUserProfile } from '../types/oauth-profile.type';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private readonly configService: ConfigService) {
    super({
      clientID: configService.getOrThrow<string>('OAUTH_GOOGLE_CLIENT_ID'),
      clientSecret: configService.getOrThrow<string>('OAUTH_GOOGLE_CLIENT_SECRET'),
      callbackURL: configService.getOrThrow<string>('OAUTH_GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ): OAuthUserProfile {
    const { id, displayName, emails, name } = profile;
    const email = emails?.[0]?.value;
    const fullName =
      displayName?.trim() ||
      [name?.givenName, name?.familyName].filter(Boolean).join(' ').trim() ||
      undefined;

    return {
      provider: 'google',
      providerId: id,
      email,
      name: fullName,
    };
  }
}
