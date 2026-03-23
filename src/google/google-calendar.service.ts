import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { randomUUID } from 'crypto';

@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);
  private readonly oauth2Client: OAuth2Client | null = null;
  private readonly calendarId: string;

  constructor(private readonly config: ConfigService) {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
    const refreshToken = this.config.get<string>('GOOGLE_REFRESH_TOKEN');
    this.calendarId = this.config.get<string>('GOOGLE_CALENDAR_ID') || 'primary';

    if (clientId && clientSecret && refreshToken) {
      this.oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        this.config.get<string>('GOOGLE_OAUTH_REDIRECT_URI') ??
          'https://developers.google.com/oauthplayground',
      );
      this.oauth2Client.setCredentials({ refresh_token: refreshToken });
    }
  }

  isConfigured(): boolean {
    return this.oauth2Client !== null;
  }

  /**
   * Creates a Calendar event with a Google Meet link (uses Calendar API + conferenceData).
   */
  async createEventWithMeetLink(input: {
    summary: string;
    startAt: Date;
    endAt: Date;
    attendeeEmails: string[];
  }): Promise<{ meetLink: string; eventId: string }> {
    if (!this.oauth2Client) {
      throw new Error(
        'Google Calendar is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN.',
      );
    }

    const calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
    const res = await calendar.events.insert({
      calendarId: this.calendarId,
      conferenceDataVersion: 1,
      requestBody: {
        summary: input.summary,
        start: {
          dateTime: input.startAt.toISOString(),
          timeZone: 'UTC',
        },
        end: {
          dateTime: input.endAt.toISOString(),
          timeZone: 'UTC',
        },
        attendees: input.attendeeEmails
          .filter((e) => typeof e === 'string' && e.includes('@'))
          .map((email) => ({ email })),
        conferenceData: {
          createRequest: {
            requestId: randomUUID(),
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      },
    });

    const data = res.data;
    const meetLink =
      data.hangoutLink ||
      data.conferenceData?.entryPoints?.find(
        (e) => e.entryPointType === 'video',
      )?.uri;

    if (!meetLink || !data.id) {
      this.logger.error(JSON.stringify(data));
      throw new Error('Calendar did not return a Meet link or event id');
    }
    return { meetLink, eventId: data.id };
  }
}
