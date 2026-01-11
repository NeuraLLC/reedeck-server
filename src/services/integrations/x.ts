import axios from 'axios';
import { OAuthService, OAuthConfig } from '../oauth';
import { encryptObject, decryptObject } from '../encryption';
import crypto from 'crypto';

interface XOAuthTokenResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
  scope: string;
  refresh_token?: string;
}

export class XIntegration {
  private static getConfig(): OAuthConfig {
    return {
      clientId: process.env.X_CLIENT_ID!,
      clientSecret: process.env.X_CLIENT_SECRET!,
      redirectUri: process.env.X_REDIRECT_URI!,
      authorizationUrl: 'https://twitter.com/i/oauth2/authorize',
      tokenUrl: 'https://api.twitter.com/2/oauth2/token',
      scopes: [
        'tweet.read',
        'tweet.write',
        'users.read',
        'dm.read',
        'dm.write',
      ],
    };
  }

  /**
   * Generate authorization URL with PKCE
   */
  static generateAuthUrl(state: string): string {
    const config = this.getConfig();

    // Generate PKCE code verifier and challenge
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    // Store code_verifier temporarily (in production, use Redis with state as key)
    // For now, we'll handle it in the callback
    return `${config.authorizationUrl}?${params.toString()}`;
  }

  /**
   * Exchange code for access token
   */
  static async exchangeCodeForToken(code: string, codeVerifier?: string): Promise<any> {
    const config = this.getConfig();

    const params: any = {
      client_id: config.clientId,
      code,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    };

    // Add code_verifier for PKCE if provided
    if (codeVerifier) {
      params.code_verifier = codeVerifier;
    }

    // Create Basic Auth header
    const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

    const response = await axios.post<XOAuthTokenResponse>(
      config.tokenUrl,
      new URLSearchParams(params),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${auth}`,
        },
      }
    );

    // Get user info
    const userInfo = await axios.get('https://api.twitter.com/2/users/me', {
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
      bearer_token: process.env.X_BEARER_TOKEN, // Store app-level bearer token
    };

    return {
      credentials: encryptObject(credentials),
      metadata: {
        userId: userInfo.data.data.id,
        username: userInfo.data.data.username,
        name: userInfo.data.data.name,
      },
      sourceId: userInfo.data.data.id,
    };
  }

  /**
   * Send direct message
   */
  static async sendDirectMessage(
    credentials: string,
    recipientId: string,
    text: string
  ): Promise<void> {
    const decrypted = decryptObject(credentials);

    await axios.post(
      'https://api.twitter.com/2/dm_conversations/with/:participant_id/messages',
      {
        text,
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
   * Post tweet
   */
  static async postTweet(credentials: string, text: string): Promise<any> {
    const decrypted = decryptObject(credentials);

    const response = await axios.post(
      'https://api.twitter.com/2/tweets',
      {
        text,
      },
      {
        headers: {
          Authorization: `Bearer ${decrypted.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  }

  /**
   * Reply to tweet
   */
  static async replyToTweet(
    credentials: string,
    tweetId: string,
    text: string
  ): Promise<any> {
    const decrypted = decryptObject(credentials);

    const response = await axios.post(
      'https://api.twitter.com/2/tweets',
      {
        text,
        reply: {
          in_reply_to_tweet_id: tweetId,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${decrypted.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  }

  /**
   * Get user's mentions (using app-level bearer token)
   */
  static async getMentions(credentials: string, userId: string): Promise<any[]> {
    const decrypted = decryptObject(credentials);

    const response = await axios.get(
      `https://api.twitter.com/2/users/${userId}/mentions`,
      {
        headers: {
          Authorization: `Bearer ${decrypted.bearer_token || decrypted.access_token}`,
        },
        params: {
          max_results: 100,
          'tweet.fields': 'created_at,author_id,conversation_id',
        },
      }
    );

    return response.data.data || [];
  }

  /**
   * Verify webhook signature (for Account Activity API)
   */
  static verifyWebhookSignature(
    signature: string,
    body: string
  ): boolean {
    const consumerSecret = process.env.X_CLIENT_SECRET!;

    const hmac = crypto
      .createHmac('sha256', consumerSecret)
      .update(body)
      .digest('base64');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(`sha256=${hmac}`)
    );
  }

  /**
   * Refresh access token
   */
  static async refreshAccessToken(credentials: string): Promise<any> {
    const decrypted = decryptObject(credentials);
    const config = this.getConfig();

    if (!decrypted.refresh_token) {
      throw new Error('No refresh token available');
    }

    const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

    const response = await axios.post<XOAuthTokenResponse>(
      config.tokenUrl,
      new URLSearchParams({
        refresh_token: decrypted.refresh_token,
        grant_type: 'refresh_token',
        client_id: config.clientId,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${auth}`,
        },
      }
    );

    const newCredentials = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token || decrypted.refresh_token,
      expires_in: response.data.expires_in,
      scope: response.data.scope,
      bearer_token: decrypted.bearer_token,
    };

    return {
      credentials: encryptObject(newCredentials),
    };
  }
}
