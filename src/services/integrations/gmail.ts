import axios from 'axios';
import { OAuthService, OAuthConfig } from '../oauth';
import { encryptObject, decryptObject } from '../encryption';

export class GmailIntegration {
  private static getConfig(): OAuthConfig {
    return {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri: process.env.GOOGLE_REDIRECT_URI!,
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
    };
  }

  /**
   * Generate authorization URL
   */
  static generateAuthUrl(state: string): string {
    const config = this.getConfig();
    const { url } = OAuthService.generateAuthUrl(config, state);
    // Add access_type=offline to get refresh token
    return `${url}&access_type=offline&prompt=consent`;
  }

  /**
   * Exchange code for access token
   */
  static async exchangeCodeForToken(code: string): Promise<any> {
    const config = this.getConfig();
    const tokenResponse = await OAuthService.exchangeCodeForToken(config, code);

    // Get user info
    const userInfo = await axios.get(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: {
          Authorization: `Bearer ${tokenResponse.access_token}`,
        },
      }
    );

    // Encrypt and store credentials
    const credentials = {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      expires_in: tokenResponse.expires_in,
      token_type: tokenResponse.token_type,
    };

    return {
      credentials: encryptObject(credentials),
      metadata: {
        email: userInfo.data.email,
        userId: userInfo.data.id,
      },
      sourceId: userInfo.data.id,
    };
  }

  /**
   * Refresh access token
   */
  static async refreshAccessToken(credentials: string): Promise<string> {
    const config = this.getConfig();
    const decrypted = decryptObject(credentials);

    const tokenResponse = await OAuthService.refreshAccessToken(
      config,
      decrypted.refresh_token
    );

    const newCredentials = {
      ...decrypted,
      access_token: tokenResponse.access_token,
      expires_in: tokenResponse.expires_in,
    };

    return encryptObject(newCredentials);
  }

  /**
   * Send email via Gmail API
   */
  static async sendEmail(
    credentials: string,
    to: string,
    subject: string,
    body: string
  ): Promise<void> {
    const decrypted = decryptObject(credentials);

    const email = [
      `To: ${to}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${subject}`,
      '',
      body,
    ].join('\n');

    const encodedEmail = Buffer.from(email)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await axios.post(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        raw: encodedEmail,
      },
      {
        headers: {
          Authorization: `Bearer ${decrypted.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );
  }

  /**
   * Watch for new emails (set up push notifications)
   */
  static async watchMailbox(
    credentials: string,
    topicName: string
  ): Promise<void> {
    const decrypted = decryptObject(credentials);

    await axios.post(
      'https://gmail.googleapis.com/gmail/v1/users/me/watch',
      {
        topicName,
        labelIds: ['INBOX'],
      },
      {
        headers: {
          Authorization: `Bearer ${decrypted.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );
  }
}
