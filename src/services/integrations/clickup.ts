import axios from 'axios';
import { OAuthService, OAuthConfig } from '../oauth';
import { encryptObject, decryptObject } from '../encryption';

export class ClickUpIntegration {
  private static getConfig(): OAuthConfig {
    return {
      clientId: process.env.CLICKUP_CLIENT_ID!,
      clientSecret: process.env.CLICKUP_CLIENT_SECRET!,
      redirectUri: process.env.CLICKUP_REDIRECT_URI!,
      authorizationUrl: 'https://app.clickup.com/api',
      tokenUrl: 'https://api.clickup.com/api/v2/oauth/token',
      scopes: [],
    };
  }

  /**
   * Generate authorization URL
   */
  static generateAuthUrl(state: string): string {
    const config = this.getConfig();
    return `https://app.clickup.com/api?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(config.redirectUri)}&state=${state}`;
  }

  /**
   * Exchange code for access token
   */
  static async exchangeCodeForToken(code: string): Promise<any> {
    const config = this.getConfig();

    const response = await axios.post(config.tokenUrl, {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
    });

    // Get user info and workspaces
    const user = await axios.get('https://api.clickup.com/api/v2/user', {
      headers: {
        Authorization: response.data.access_token,
      },
    });

    const teams = await axios.get('https://api.clickup.com/api/v2/team', {
      headers: {
        Authorization: response.data.access_token,
      },
    });

    const credentials = {
      access_token: response.data.access_token,
    };

    return {
      credentials: encryptObject(credentials),
      metadata: {
        userId: user.data.user.id,
        username: user.data.user.username,
        teams: teams.data.teams,
      },
      sourceId: user.data.user.id.toString(),
    };
  }

  /**
   * Validate API key (alternative to OAuth)
   */
  static async validateApiKey(apiKey: string): Promise<any> {
    try {
      const user = await axios.get('https://api.clickup.com/api/v2/user', {
        headers: {
          Authorization: apiKey,
        },
      });

      const teams = await axios.get('https://api.clickup.com/api/v2/team', {
        headers: {
          Authorization: apiKey,
        },
      });

      const credentials = {
        api_key: apiKey,
      };

      return {
        credentials: encryptObject(credentials),
        metadata: {
          userId: user.data.user.id,
          username: user.data.user.username,
          teams: teams.data.teams,
        },
        sourceId: user.data.user.id.toString(),
      };
    } catch (error) {
      throw new Error('Invalid ClickUp API key');
    }
  }

  /**
   * Create task
   */
  static async createTask(
    credentials: string,
    listId: string,
    name: string,
    description?: string,
    priority?: number
  ): Promise<any> {
    const decrypted = decryptObject(credentials);
    const token = decrypted.access_token || decrypted.api_key;

    const response = await axios.post(
      `https://api.clickup.com/api/v2/list/${listId}/task`,
      {
        name,
        description,
        priority,
      },
      {
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  }

  /**
   * Verify webhook signature
   */
  static verifyWebhookSignature(signature: string, body: string): boolean {
    const crypto = require('crypto');
    const secret = process.env.CLICKUP_WEBHOOK_SECRET || '';

    const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(hmac)
    );
  }
}
