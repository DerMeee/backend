export type OAuthProvider = 'google' | 'facebook';

/** Attached to `req.user` after Google/Facebook Passport strategies validate. */
export interface OAuthUserProfile {
  provider: OAuthProvider;
  providerId: string;
  email?: string;
  name?: string;
}
