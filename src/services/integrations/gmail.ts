import axios from 'axios';
import { OAuthService, OAuthConfig } from '../oauth';
import { encryptObject, decryptObject } from '../encryption';

export interface ParsedEmail {
  messageId: string;
  threadId: string;
  from: string;
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  body: string;
  date: string;
  inReplyTo?: string;
  references?: string;
}

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

  /**
   * Get the connected Gmail profile (email address)
   */
  static async getProfile(
    credentials: string
  ): Promise<{ emailAddress: string; historyId: string }> {
    const decrypted = decryptObject(credentials);

    const response = await axios.get(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      {
        headers: {
          Authorization: `Bearer ${decrypted.access_token}`,
        },
      }
    );

    return {
      emailAddress: response.data.emailAddress,
      historyId: response.data.historyId,
    };
  }

  /**
   * Get new messages since a specific historyId.
   * Returns message IDs of newly added inbox messages.
   */
  static async getHistory(
    credentials: string,
    startHistoryId: string
  ): Promise<string[]> {
    const decrypted = decryptObject(credentials);

    try {
      const response = await axios.get(
        'https://gmail.googleapis.com/gmail/v1/users/me/history',
        {
          params: {
            startHistoryId,
            historyTypes: 'messageAdded',
            labelId: 'INBOX',
          },
          headers: {
            Authorization: `Bearer ${decrypted.access_token}`,
          },
        }
      );

      const messageIds: string[] = [];
      const history = response.data.history || [];
      for (const record of history) {
        if (record.messagesAdded) {
          for (const added of record.messagesAdded) {
            // Only include messages that landed in INBOX
            if (added.message?.labelIds?.includes('INBOX')) {
              messageIds.push(added.message.id);
            }
          }
        }
      }

      return messageIds;
    } catch (error: any) {
      // 404 means historyId is too old; caller should do a full sync
      if (error.response?.status === 404) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Fetch and parse a single email message by ID.
   */
  static async getMessage(
    credentials: string,
    messageId: string
  ): Promise<ParsedEmail> {
    const decrypted = decryptObject(credentials);

    const response = await axios.get(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`,
      {
        params: { format: 'full' },
        headers: {
          Authorization: `Bearer ${decrypted.access_token}`,
        },
      }
    );

    return this.parseGmailMessage(response.data);
  }

  /**
   * Reply to an email thread via Gmail API.
   * Preserves threading by setting In-Reply-To and References headers.
   */
  static async replyToEmail(
    credentials: string,
    to: string,
    subject: string,
    body: string,
    threadId: string,
    inReplyTo?: string
  ): Promise<{ messageId: string; threadId: string }> {
    const decrypted = decryptObject(credentials);

    // Build RFC 2822 email with threading headers
    const headers = [
      `To: ${to}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${subject.startsWith('Re:') ? subject : `Re: ${subject}`}`,
    ];

    if (inReplyTo) {
      headers.push(`In-Reply-To: ${inReplyTo}`);
      headers.push(`References: ${inReplyTo}`);
    }

    const email = [...headers, '', body].join('\n');

    const encodedEmail = Buffer.from(email)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await axios.post(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        raw: encodedEmail,
        threadId,
      },
      {
        headers: {
          Authorization: `Bearer ${decrypted.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return {
      messageId: response.data.id,
      threadId: response.data.threadId,
    };
  }

  /**
   * Parse a Gmail API message payload into a clean ParsedEmail object.
   */
  private static parseGmailMessage(message: any): ParsedEmail {
    const headers = message.payload?.headers || [];
    const getHeader = (name: string): string => {
      const header = headers.find(
        (h: any) => h.name.toLowerCase() === name.toLowerCase()
      );
      return header?.value || '';
    };

    const from = getHeader('From');
    const { name: fromName, email: fromEmail } = this.parseEmailAddress(from);

    // Extract body — prefer text/plain, fall back to text/html
    let body = '';
    const payload = message.payload;

    if (payload.body?.data) {
      body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    } else if (payload.parts) {
      // Multipart message — walk parts to find text
      body = this.extractBodyFromParts(payload.parts);
    }

    return {
      messageId: message.id,
      threadId: message.threadId,
      from,
      fromName,
      fromEmail,
      to: getHeader('To'),
      subject: getHeader('Subject'),
      body,
      date: getHeader('Date'),
      inReplyTo: getHeader('In-Reply-To') || undefined,
      references: getHeader('References') || undefined,
    };
  }

  /**
   * Parse "Name <email@example.com>" into name and email.
   */
  private static parseEmailAddress(raw: string): {
    name: string;
    email: string;
  } {
    const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
    if (match) {
      return {
        name: match[1].replace(/^["']|["']$/g, '').trim(),
        email: match[2].trim(),
      };
    }
    // Plain email address
    return { name: raw.trim(), email: raw.trim() };
  }

  /**
   * Recursively extract text body from MIME multipart message parts.
   */
  private static extractBodyFromParts(parts: any[]): string {
    let textBody = '';
    let htmlBody = '';

    for (const part of parts) {
      if (part.parts) {
        const nested = this.extractBodyFromParts(part.parts);
        if (nested) return nested;
      }
      if (part.mimeType === 'text/plain' && part.body?.data) {
        textBody = Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
      if (part.mimeType === 'text/html' && part.body?.data) {
        htmlBody = Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
    }

    // Prefer plain text, fall back to HTML with tags stripped
    if (textBody) return textBody;
    if (htmlBody) return htmlBody.replace(/<[^>]*>/g, '');
    return '';
  }
}
