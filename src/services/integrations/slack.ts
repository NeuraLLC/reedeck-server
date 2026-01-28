import axios from 'axios';
import { OAuthService, OAuthConfig } from '../oauth';
import { encryptObject, decryptObject } from '../encryption';

interface SlackOAuthTokenResponse {
  ok: boolean;
  access_token: string;
  token_type: string;
  scope: string;
  bot_user_id?: string;
  app_id?: string;
  team: {
    name: string;
    id: string;
  };
  authed_user?: {
    id: string;
    scope?: string;
    access_token?: string;
    token_type?: string;
  };
}

export interface SlackUserInfo {
  id: string;
  name: string;
  realName: string;
  email?: string;
  avatar?: string;
}

export class SlackIntegration {
  private static getConfig(): OAuthConfig {
    return {
      clientId: process.env.SLACK_CLIENT_ID!,
      clientSecret: process.env.SLACK_CLIENT_SECRET!,
      redirectUri: process.env.SLACK_REDIRECT_URI!,
      authorizationUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      scopes: [
        'channels:read',
        'chat:write',
        'users:read',
        'users:read.email',
        'im:read',
        'im:history',
        'im:write',
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

    const response = await axios.post<SlackOAuthTokenResponse>(
      config.tokenUrl,
      new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    if (!response.data.ok) {
      throw new Error('Failed to exchange code for token');
    }

    // Encrypt and store credentials
    const credentials = {
      access_token: response.data.access_token,
      team_id: response.data.team.id,
      team_name: response.data.team.name,
      bot_user_id: response.data.bot_user_id,
      scope: response.data.scope,
    };

    return {
      credentials: encryptObject(credentials),
      metadata: {
        teamName: response.data.team.name,
        teamId: response.data.team.id,
      },
      sourceId: response.data.team.id,
    };
  }

  /**
   * Verify webhook signature
   */
  static verifyWebhookSignature(
    timestamp: string,
    body: string,
    signature: string
  ): boolean {
    const crypto = require('crypto');
    const signingSecret = process.env.SLACK_SIGNING_SECRET!;

    const baseString = `v0:${timestamp}:${body}`;
    const hmac = crypto
      .createHmac('sha256', signingSecret)
      .update(baseString)
      .digest('hex');
    const computedSignature = `v0=${hmac}`;

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(computedSignature)
    );
  }

  /**
   * Send message to Slack channel
   */
  static async sendMessage(
    credentials: string,
    channel: string,
    text: string,
    threadTs?: string
  ): Promise<{ ts: string }> {
    const decrypted = decryptObject(credentials);

    const payload: any = {
      channel,
      text,
    };

    // Reply in thread if threadTs is provided
    if (threadTs) {
      payload.thread_ts = threadTs;
    }

    const response = await axios.post(
      'https://slack.com/api/chat.postMessage',
      payload,
      {
        headers: {
          Authorization: `Bearer ${decrypted.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return { ts: response.data.ts };
  }

  /**
   * Get Slack user info (real name, email, avatar)
   */
  static async getUserInfo(
    credentials: string,
    userId: string
  ): Promise<SlackUserInfo> {
    const decrypted = decryptObject(credentials);

    const response = await axios.get(
      `https://slack.com/api/users.info?user=${userId}`,
      {
        headers: {
          Authorization: `Bearer ${decrypted.access_token}`,
        },
      }
    );

    if (!response.data.ok) {
      throw new Error(`Failed to fetch Slack user info: ${response.data.error}`);
    }

    const user = response.data.user;
    return {
      id: user.id,
      name: user.name,
      realName: user.real_name || user.name,
      email: user.profile?.email,
      avatar: user.profile?.image_72,
    };
  }

  /**
   * Get Slack channel info
   */
  static async getChannelInfo(
    credentials: string,
    channelId: string
  ): Promise<{ name: string; id: string }> {
    const decrypted = decryptObject(credentials);

    const response = await axios.get(
      `https://slack.com/api/conversations.info?channel=${channelId}`,
      {
        headers: {
          Authorization: `Bearer ${decrypted.access_token}`,
        },
      }
    );

    if (!response.data.ok) {
      return { name: channelId, id: channelId };
    }

    return {
      name: response.data.channel.name || channelId,
      id: channelId,
    };
  }
}
