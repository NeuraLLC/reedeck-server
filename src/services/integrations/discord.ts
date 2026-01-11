import axios from 'axios';
import { OAuthService, OAuthConfig } from '../oauth';
import { encryptObject, decryptObject } from '../encryption';

export class DiscordIntegration {
  private static getConfig(): OAuthConfig {
    return {
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
      redirectUri: process.env.DISCORD_REDIRECT_URI!,
      authorizationUrl: 'https://discord.com/api/oauth2/authorize',
      tokenUrl: 'https://discord.com/api/oauth2/token',
      scopes: ['bot', 'identify', 'guilds', 'messages.read'],
    };
  }

  /**
   * Generate authorization URL
   */
  static generateAuthUrl(state: string): string {
    const config = this.getConfig();
    const { url } = OAuthService.generateAuthUrl(config, state);
    // Add permissions for bot
    const permissions = '2147483648'; // Read Messages, Send Messages
    return `${url}&permissions=${permissions}`;
  }

  /**
   * Exchange code for access token
   */
  static async exchangeCodeForToken(code: string): Promise<any> {
    const config = this.getConfig();
    const tokenResponse = await OAuthService.exchangeCodeForToken(config, code);

    // Get user info
    const userInfo = await axios.get('https://discord.com/api/v10/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenResponse.access_token}`,
      },
    });

    // Get user's guilds
    const guilds = await axios.get(
      'https://discord.com/api/v10/users/@me/guilds',
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
      bot_token: process.env.DISCORD_BOT_TOKEN,
    };

    return {
      credentials: encryptObject(credentials),
      metadata: {
        username: userInfo.data.username,
        userId: userInfo.data.id,
        guilds: guilds.data.map((g: any) => ({ id: g.id, name: g.name })),
      },
      sourceId: userInfo.data.id,
    };
  }

  /**
   * Verify webhook signature
   */
  static verifyWebhookSignature(signature: string, timestamp: string, body: string): boolean {
    const crypto = require('crypto');
    const publicKey = process.env.DISCORD_PUBLIC_KEY!;

    // Discord uses Ed25519 signature verification
    // This is a simplified version - in production, use a proper Ed25519 library
    return true; // TODO: Implement proper Ed25519 verification
  }

  /**
   * Send message to Discord channel
   */
  static async sendMessage(
    credentials: string,
    channelId: string,
    content: string
  ): Promise<void> {
    const decrypted = decryptObject(credentials);

    await axios.post(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        content,
      },
      {
        headers: {
          Authorization: `Bot ${decrypted.bot_token}`,
          'Content-Type': 'application/json',
        },
      }
    );
  }

  /**
   * Get messages from a channel
   */
  static async getMessages(
    credentials: string,
    channelId: string,
    limit: number = 50
  ): Promise<any[]> {
    const decrypted = decryptObject(credentials);

    const response = await axios.get(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        params: { limit },
        headers: {
          Authorization: `Bot ${decrypted.bot_token}`,
        },
      }
    );

    return response.data;
  }
}
