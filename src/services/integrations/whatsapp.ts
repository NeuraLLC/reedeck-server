import axios from 'axios';
import crypto from 'crypto';
import { encryptObject, decryptObject } from '../encryption';

export class WhatsAppIntegration {
  /**
   * Validate Twilio credentials
   */
  static async validateCredentials(
    accountSid: string,
    authToken: string,
    phoneNumber: string
  ): Promise<any> {
    try {
      // Verify credentials by making a test API call
      const response = await axios.get(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`,
        {
          auth: {
            username: accountSid,
            password: authToken,
          },
        }
      );

      const credentials = {
        account_sid: accountSid,
        auth_token: authToken,
        phone_number: phoneNumber,
      };

      return {
        credentials: encryptObject(credentials),
        metadata: {
          accountSid,
          phoneNumber,
          friendlyName: response.data.friendly_name,
          status: response.data.status,
        },
        sourceId: phoneNumber,
      };
    } catch (error) {
      throw new Error('Invalid WhatsApp/Twilio credentials');
    }
  }

  /**
   * Verify webhook signature (Twilio)
   */
  static verifyWebhookSignature(
    url: string,
    params: Record<string, string>,
    signature: string,
    authToken: string
  ): boolean {
    const crypto = require('crypto');

    // Create the signature base string
    let data = url;
    Object.keys(params)
      .sort()
      .forEach((key) => {
        data += key + params[key];
      });

    // Compute the HMAC
    const hmac = crypto
      .createHmac('sha1', authToken)
      .update(Buffer.from(data, 'utf-8'))
      .digest('base64');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(hmac)
    );
  }

  /**
   * Send WhatsApp message via Twilio
   */
  static async sendMessage(
    credentials: string,
    to: string,
    body: string
  ): Promise<void> {
    const decrypted = decryptObject(credentials);

    // Ensure phone numbers are in E.164 format
    const fromNumber = decrypted.phone_number.startsWith('whatsapp:')
      ? decrypted.phone_number
      : `whatsapp:${decrypted.phone_number}`;
    const toNumber = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

    await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${decrypted.account_sid}/Messages.json`,
      new URLSearchParams({
        From: fromNumber,
        To: toNumber,
        Body: body,
      }),
      {
        auth: {
          username: decrypted.account_sid,
          password: decrypted.auth_token,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
  }

  /**
   * Send WhatsApp template message
   */
  static async sendTemplateMessage(
    credentials: string,
    to: string,
    templateSid: string,
    contentVariables: Record<string, string>
  ): Promise<void> {
    const decrypted = decryptObject(credentials);

    const fromNumber = decrypted.phone_number.startsWith('whatsapp:')
      ? decrypted.phone_number
      : `whatsapp:${decrypted.phone_number}`;
    const toNumber = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

    await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${decrypted.account_sid}/Messages.json`,
      new URLSearchParams({
        From: fromNumber,
        To: toNumber,
        ContentSid: templateSid,
        ContentVariables: JSON.stringify(contentVariables),
      }),
      {
        auth: {
          username: decrypted.account_sid,
          password: decrypted.auth_token,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
  }

  /**
   * Send media message
   */
  static async sendMediaMessage(
    credentials: string,
    to: string,
    mediaUrl: string,
    caption?: string
  ): Promise<void> {
    const decrypted = decryptObject(credentials);

    const fromNumber = decrypted.phone_number.startsWith('whatsapp:')
      ? decrypted.phone_number
      : `whatsapp:${decrypted.phone_number}`;
    const toNumber = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

    const params: any = {
      From: fromNumber,
      To: toNumber,
      MediaUrl: mediaUrl,
    };

    if (caption) {
      params.Body = caption;
    }

    await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${decrypted.account_sid}/Messages.json`,
      new URLSearchParams(params),
      {
        auth: {
          username: decrypted.account_sid,
          password: decrypted.auth_token,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
  }
}
