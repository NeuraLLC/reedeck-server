import axios from 'axios';
import crypto from 'crypto';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

/**
 * Generic OAuth 2.0 service
 */
export class OAuthService {
  /**
   * Generate authorization URL with state parameter for CSRF protection
   */
  static generateAuthUrl(config: OAuthConfig, state?: string): { url: string; state: string } {
    const stateParam = state || crypto.randomBytes(16).toString('hex');

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scopes.join(' '),
      state: stateParam,
      response_type: 'code',
    });

    return {
      url: `${config.authorizationUrl}?${params.toString()}`,
      state: stateParam,
    };
  }

  /**
   * Exchange authorization code for access token
   */
  static async exchangeCodeForToken(
    config: OAuthConfig,
    code: string
  ): Promise<OAuthTokenResponse> {
    const response = await axios.post(
      config.tokenUrl,
      {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      },
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
      }
    );

    return response.data;
  }

  /**
   * Refresh access token using refresh token
   */
  static async refreshAccessToken(
    config: OAuthConfig,
    refreshToken: string
  ): Promise<OAuthTokenResponse> {
    const response = await axios.post(
      config.tokenUrl,
      {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      },
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
      }
    );

    return response.data;
  }

  /**
   * Validate state parameter for CSRF protection
   */
  static validateState(receivedState: string, expectedState: string): boolean {
    return receivedState === expectedState;
  }
}
