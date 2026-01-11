import axios from 'axios';
import { OAuthService, OAuthConfig } from '../oauth';
import { encryptObject, decryptObject } from '../encryption';
import crypto from 'crypto';

interface InstagramOAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

interface InstagramLongLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export class InstagramIntegration {
  private static getConfig(): OAuthConfig {
    return {
      clientId: process.env.INSTAGRAM_APP_ID!,
      clientSecret: process.env.INSTAGRAM_APP_SECRET!,
      redirectUri: process.env.INSTAGRAM_REDIRECT_URI!,
      authorizationUrl: 'https://api.instagram.com/oauth/authorize',
      tokenUrl: 'https://api.instagram.com/oauth/access_token',
      scopes: [
        'instagram_basic',
        'instagram_manage_messages',
        'instagram_manage_comments',
        'pages_show_list',
        'pages_read_engagement',
      ],
    };
  }

  /**
   * Generate authorization URL
   */
  static generateAuthUrl(state: string): string {
    const config = this.getConfig();

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scopes.join(','),
      response_type: 'code',
      state,
    });

    return `${config.authorizationUrl}?${params.toString()}`;
  }

  /**
   * Exchange code for access token
   */
  static async exchangeCodeForToken(code: string): Promise<any> {
    const config = this.getConfig();

    // Step 1: Get short-lived token
    const response = await axios.post<InstagramOAuthTokenResponse>(
      config.tokenUrl,
      new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    // Step 2: Exchange for long-lived token (60 days)
    const longLivedResponse = await axios.get<InstagramLongLivedTokenResponse>(
      'https://graph.instagram.com/access_token',
      {
        params: {
          grant_type: 'ig_exchange_token',
          client_secret: config.clientSecret,
          access_token: response.data.access_token,
        },
      }
    );

    // Get user info
    const userInfo = await axios.get(
      'https://graph.instagram.com/me',
      {
        params: {
          fields: 'id,username,account_type',
          access_token: longLivedResponse.data.access_token,
        },
      }
    );

    // Encrypt and store credentials
    const credentials = {
      access_token: longLivedResponse.data.access_token,
      expires_in: longLivedResponse.data.expires_in,
      token_type: longLivedResponse.data.token_type,
    };

    return {
      credentials: encryptObject(credentials),
      metadata: {
        userId: userInfo.data.id,
        username: userInfo.data.username,
        accountType: userInfo.data.account_type,
      },
      sourceId: userInfo.data.id,
    };
  }

  /**
   * Send reply to Instagram message
   */
  static async replyToMessage(
    credentials: string,
    messageId: string,
    text: string
  ): Promise<void> {
    const decrypted = decryptObject(credentials);

    await axios.post(
      `https://graph.instagram.com/v21.0/${messageId}/replies`,
      {
        message: text,
      },
      {
        params: {
          access_token: decrypted.access_token,
        },
      }
    );
  }

  /**
   * Reply to comment
   */
  static async replyToComment(
    credentials: string,
    commentId: string,
    text: string
  ): Promise<any> {
    const decrypted = decryptObject(credentials);

    const response = await axios.post(
      `https://graph.instagram.com/v21.0/${commentId}/replies`,
      {
        message: text,
      },
      {
        params: {
          access_token: decrypted.access_token,
        },
      }
    );

    return response.data;
  }

  /**
   * Get user's media (posts)
   */
  static async getUserMedia(credentials: string, userId: string): Promise<any[]> {
    const decrypted = decryptObject(credentials);

    const response = await axios.get(
      `https://graph.instagram.com/v21.0/${userId}/media`,
      {
        params: {
          fields: 'id,caption,media_type,media_url,permalink,timestamp,comments_count',
          access_token: decrypted.access_token,
        },
      }
    );

    return response.data.data || [];
  }

  /**
   * Get comments on a media post
   */
  static async getMediaComments(
    credentials: string,
    mediaId: string
  ): Promise<any[]> {
    const decrypted = decryptObject(credentials);

    const response = await axios.get(
      `https://graph.instagram.com/v21.0/${mediaId}/comments`,
      {
        params: {
          fields: 'id,text,username,timestamp,replies',
          access_token: decrypted.access_token,
        },
      }
    );

    return response.data.data || [];
  }

  /**
   * Get Instagram messages
   */
  static async getMessages(
    credentials: string,
    conversationId: string
  ): Promise<any[]> {
    const decrypted = decryptObject(credentials);

    const response = await axios.get(
      `https://graph.instagram.com/v21.0/${conversationId}/messages`,
      {
        params: {
          fields: 'id,message,from,created_time',
          access_token: decrypted.access_token,
        },
      }
    );

    return response.data.data || [];
  }

  /**
   * Refresh long-lived token (before 60 days expire)
   */
  static async refreshAccessToken(credentials: string): Promise<any> {
    const decrypted = decryptObject(credentials);

    const response = await axios.get<InstagramLongLivedTokenResponse>(
      'https://graph.instagram.com/refresh_access_token',
      {
        params: {
          grant_type: 'ig_refresh_token',
          access_token: decrypted.access_token,
        },
      }
    );

    const newCredentials = {
      access_token: response.data.access_token,
      expires_in: response.data.expires_in,
      token_type: response.data.token_type,
    };

    return {
      credentials: encryptObject(newCredentials),
    };
  }

  /**
   * Verify webhook signature (for webhooks from Facebook)
   */
  static verifyWebhookSignature(signature: string, body: string): boolean {
    const appSecret = process.env.INSTAGRAM_APP_SECRET!;

    const expectedSignature = crypto
      .createHmac('sha256', appSecret)
      .update(body)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(`sha256=${expectedSignature}`)
    );
  }

  /**
   * Verify webhook challenge (for initial webhook setup)
   */
  static verifyWebhookChallenge(
    mode: string,
    token: string,
    challenge: string
  ): string | null {
    const verifyToken = process.env.INSTAGRAM_VERIFY_TOKEN || 'reedeck_instagram_verify';

    if (mode === 'subscribe' && token === verifyToken) {
      return challenge;
    }

    return null;
  }

  /**
   * Subscribe to webhooks for Instagram account
   */
  static async subscribeToWebhooks(
    credentials: string,
    instagramUserId: string,
    webhookUrl: string
  ): Promise<void> {
    const decrypted = decryptObject(credentials);

    // Subscribe to Instagram webhooks
    await axios.post(
      `https://graph.facebook.com/v21.0/${instagramUserId}/subscribed_apps`,
      {
        subscribed_fields: ['messages', 'messaging_postbacks', 'message_echoes', 'message_reads', 'comments'],
      },
      {
        params: {
          access_token: decrypted.access_token,
        },
      }
    );
  }
}
