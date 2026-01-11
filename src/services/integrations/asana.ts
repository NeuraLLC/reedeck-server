import axios from 'axios';
import { OAuthService, OAuthConfig } from '../oauth';
import { encryptObject, decryptObject } from '../encryption';
import crypto from 'crypto';

interface AsanaOAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  data: {
    id: string;
    name: string;
    email: string;
  };
}

export class AsanaIntegration {
  private static getConfig(): OAuthConfig {
    return {
      clientId: process.env.ASANA_CLIENT_ID!,
      clientSecret: process.env.ASANA_CLIENT_SECRET!,
      redirectUri: process.env.ASANA_REDIRECT_URI!,
      authorizationUrl: 'https://app.asana.com/-/oauth_authorize',
      tokenUrl: 'https://app.asana.com/-/oauth_token',
      scopes: [],
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

    const response = await axios.post<AsanaOAuthTokenResponse>(
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

    // Get user workspaces
    const workspaces = await axios.get(
      'https://app.asana.com/api/1.0/workspaces',
      {
        headers: {
          Authorization: `Bearer ${response.data.access_token}`,
        },
      }
    );

    // Encrypt and store credentials
    const credentials = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      expires_in: response.data.expires_in,
    };

    return {
      credentials: encryptObject(credentials),
      metadata: {
        userId: response.data.data.id,
        userName: response.data.data.name,
        userEmail: response.data.data.email,
        workspaces: workspaces.data.data,
      },
      sourceId: response.data.data.id,
    };
  }

  /**
   * Create task in Asana
   */
  static async createTask(
    credentials: string,
    workspaceId: string,
    name: string,
    notes?: string,
    projectId?: string,
    assignee?: string,
    dueOn?: string
  ): Promise<any> {
    const decrypted = decryptObject(credentials);

    const taskData: any = {
      data: {
        workspace: workspaceId,
        name,
        notes,
      },
    };

    if (projectId) {
      taskData.data.projects = [projectId];
    }

    if (assignee) {
      taskData.data.assignee = assignee;
    }

    if (dueOn) {
      taskData.data.due_on = dueOn;
    }

    const response = await axios.post(
      'https://app.asana.com/api/1.0/tasks',
      taskData,
      {
        headers: {
          Authorization: `Bearer ${decrypted.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data.data;
  }

  /**
   * Get task details
   */
  static async getTask(credentials: string, taskId: string): Promise<any> {
    const decrypted = decryptObject(credentials);

    const response = await axios.get(
      `https://app.asana.com/api/1.0/tasks/${taskId}`,
      {
        headers: {
          Authorization: `Bearer ${decrypted.access_token}`,
        },
      }
    );

    return response.data.data;
  }

  /**
   * Update task
   */
  static async updateTask(
    credentials: string,
    taskId: string,
    updates: {
      name?: string;
      notes?: string;
      completed?: boolean;
      assignee?: string;
      due_on?: string;
    }
  ): Promise<any> {
    const decrypted = decryptObject(credentials);

    const response = await axios.put(
      `https://app.asana.com/api/1.0/tasks/${taskId}`,
      {
        data: updates,
      },
      {
        headers: {
          Authorization: `Bearer ${decrypted.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data.data;
  }

  /**
   * Add comment to task
   */
  static async addComment(
    credentials: string,
    taskId: string,
    text: string
  ): Promise<any> {
    const decrypted = decryptObject(credentials);

    const response = await axios.post(
      `https://app.asana.com/api/1.0/tasks/${taskId}/stories`,
      {
        data: {
          text,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${decrypted.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data.data;
  }

  /**
   * Get projects in workspace
   */
  static async getProjects(
    credentials: string,
    workspaceId: string
  ): Promise<any[]> {
    const decrypted = decryptObject(credentials);

    const response = await axios.get(
      'https://app.asana.com/api/1.0/projects',
      {
        headers: {
          Authorization: `Bearer ${decrypted.access_token}`,
        },
        params: {
          workspace: workspaceId,
        },
      }
    );

    return response.data.data;
  }

  /**
   * Get tasks in project
   */
  static async getProjectTasks(
    credentials: string,
    projectId: string
  ): Promise<any[]> {
    const decrypted = decryptObject(credentials);

    const response = await axios.get(
      `https://app.asana.com/api/1.0/projects/${projectId}/tasks`,
      {
        headers: {
          Authorization: `Bearer ${decrypted.access_token}`,
        },
      }
    );

    return response.data.data;
  }

  /**
   * Refresh access token
   */
  static async refreshAccessToken(credentials: string): Promise<any> {
    const decrypted = decryptObject(credentials);
    const config = this.getConfig();

    const response = await axios.post<AsanaOAuthTokenResponse>(
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
    };

    return {
      credentials: encryptObject(newCredentials),
    };
  }

  /**
   * Verify webhook signature
   */
  static verifyWebhookSignature(signature: string, body: string): boolean {
    const webhookSecret = process.env.ASANA_WEBHOOK_SECRET || '';

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(body)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }
}
