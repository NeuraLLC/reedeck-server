import axios from 'axios';
import { OAuthService, OAuthConfig } from '../oauth';
import { encryptObject, decryptObject } from '../encryption';

interface TeamsOAuthTokenResponse {
  token_type: string;
  scope: string;
  expires_in: number;
  ext_expires_in: number;
  access_token: string;
  refresh_token: string;
}

export class TeamsIntegration {
  private static getConfig(): OAuthConfig {
    return {
      clientId: process.env.TEAMS_CLIENT_ID!,
      clientSecret: process.env.TEAMS_CLIENT_SECRET!,
      redirectUri: process.env.TEAMS_REDIRECT_URI!,
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scopes: [
        'https://graph.microsoft.com/User.Read',
        'https://graph.microsoft.com/Chat.Read',
        'https://graph.microsoft.com/Chat.ReadWrite',
        'https://graph.microsoft.com/ChannelMessage.Read.All',
        'https://graph.microsoft.com/ChannelMessage.Send',
      ],
    };
  }

  /**
   * Generate authorization URL
   */
  static generateAuthUrl(state: string): string {
    const config = this.getConfig();
    const { url } = OAuthService.generateAuthUrl(config, state);
    return url;
  }

  /**
   * Exchange code for access token
   */
  static async exchangeCodeForToken(code: string): Promise<any> {
    const config = this.getConfig();

    const response = await axios.post<TeamsOAuthTokenResponse>(
      config.tokenUrl,
      new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
        scope: config.scopes.join(' '),
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    // Get user info
    const userInfo = await axios.get('https://graph.microsoft.com/v1.0/me', {
      headers: {
        Authorization: `Bearer ${response.data.access_token}`,
      },
    });

    // Encrypt and store credentials
    const credentials = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      expires_in: response.data.expires_in,
      scope: response.data.scope,
    };

    return {
      credentials: encryptObject(credentials),
      metadata: {
        userId: userInfo.data.id,
        userEmail: userInfo.data.userPrincipalName,
        displayName: userInfo.data.displayName,
      },
      sourceId: userInfo.data.id,
    };
  }

  /**
   * Send message to Teams channel
   */
  static async sendChannelMessage(
    credentials: string,
    teamId: string,
    channelId: string,
    message: string
  ): Promise<void> {
    const decrypted = decryptObject(credentials);

    await axios.post(
      `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages`,
      {
        body: {
          content: message,
        },
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
   * Send chat message (1:1 or group chat)
   */
  static async sendChatMessage(
    credentials: string,
    chatId: string,
    message: string
  ): Promise<void> {
    const decrypted = decryptObject(credentials);

    await axios.post(
      `https://graph.microsoft.com/v1.0/chats/${chatId}/messages`,
      {
        body: {
          content: message,
        },
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
   * Get user's teams
   */
  static async getTeams(credentials: string): Promise<any[]> {
    const decrypted = decryptObject(credentials);

    const response = await axios.get(
      'https://graph.microsoft.com/v1.0/me/joinedTeams',
      {
        headers: {
          Authorization: `Bearer ${decrypted.access_token}`,
        },
      }
    );

    return response.data.value;
  }

  /**
   * Refresh access token
   */
  static async refreshAccessToken(credentials: string): Promise<any> {
    const decrypted = decryptObject(credentials);
    const config = this.getConfig();

    const response = await axios.post<TeamsOAuthTokenResponse>(
      config.tokenUrl,
      new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: decrypted.refresh_token,
        grant_type: 'refresh_token',
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const newCredentials = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      expires_in: response.data.expires_in,
      scope: response.data.scope,
    };

    return {
      credentials: encryptObject(newCredentials),
    };
  }
}
