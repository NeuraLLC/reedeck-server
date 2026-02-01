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
   * Verify webhook signature using Ed25519
   */
  static verifyWebhookSignature(signature: string, timestamp: string, body: string): boolean {
    try {
      const crypto = require('crypto');
      const publicKey = process.env.DISCORD_PUBLIC_KEY!;

      if (!publicKey) {
        console.error('[Discord] PUBLIC_KEY not configured');
        return false;
      }

      // Discord uses Ed25519 signature verification
      // Signature = Ed25519(timestamp + body)
      const message = timestamp + body;

      // Convert hex strings to buffers
      const signatureBuffer = Buffer.from(signature, 'hex');
      const publicKeyBuffer = Buffer.from(publicKey, 'hex');
      const messageBuffer = Buffer.from(message);

      // Verify using Node.js built-in crypto (requires Node 12+)
      return crypto.verify(
        null,
        messageBuffer,
        {
          key: publicKeyBuffer,
          format: 'der',
          type: 'spki'
        },
        signatureBuffer
      );
    } catch (error) {
      console.error('[Discord] Signature verification error:', error);
      return false;
    }
  }

  /**
   * Get user info from Discord API
   */
  static async getUserInfo(
    credentials: string,
    userId: string
  ): Promise<{ username: string; discriminator: string; email?: string; avatar?: string }> {
    const decrypted = decryptObject(credentials);

    const response = await axios.get(
      `https://discord.com/api/v10/users/${userId}`,
      {
        headers: {
          Authorization: `Bot ${decrypted.bot_token}`,
        },
      }
    );

    return {
      username: response.data.username,
      discriminator: response.data.discriminator,
      email: response.data.email,
      avatar: response.data.avatar,
    };
  }

  /**
   * Get channel info from Discord API
   */
  static async getChannelInfo(
    credentials: string,
    channelId: string
  ): Promise<{ name: string; type: number; guildId?: string }> {
    const decrypted = decryptObject(credentials);

    const response = await axios.get(
      `https://discord.com/api/v10/channels/${channelId}`,
      {
        headers: {
          Authorization: `Bot ${decrypted.bot_token}`,
        },
      }
    );

    return {
      name: response.data.name,
      type: response.data.type,
      guildId: response.data.guild_id,
    };
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
