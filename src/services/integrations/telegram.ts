import axios from 'axios';
import crypto from 'crypto';
import { encryptObject, decryptObject } from '../encryption';

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export class TelegramIntegration {
  /**
   * Validate bot token
   */
  static async validateToken(botToken: string): Promise<any> {
    try {
      const response = await axios.get(
        `https://api.telegram.org/bot${botToken}/getMe`
      );

      if (!response.data.ok) {
        throw new Error('Invalid bot token');
      }

      const botInfo: TelegramUser = response.data.result;

      // Encrypt and store credentials
      const credentials = {
        bot_token: botToken,
      };

      return {
        credentials: encryptObject(credentials),
        metadata: {
          botId: botInfo.id,
          botUsername: botInfo.username,
          botName: botInfo.first_name,
        },
        sourceId: botInfo.id.toString(),
      };
    } catch (error) {
      throw new Error('Failed to validate Telegram bot token');
    }
  }

  /**
   * Set webhook URL
   */
  static async setWebhook(credentials: string, webhookUrl: string): Promise<void> {
    const decrypted = decryptObject(credentials);

    const response = await axios.post(
      `https://api.telegram.org/bot${decrypted.bot_token}/setWebhook`,
      {
        url: webhookUrl,
        allowed_updates: ['message', 'edited_message', 'callback_query'],
      }
    );

    if (!response.data.ok) {
      throw new Error('Failed to set webhook');
    }
  }

  /**
   * Verify webhook signature
   */
  static verifyWebhookSignature(botToken: string, data: any): boolean {
    // Telegram doesn't use signature verification, but we can validate the structure
    return data && typeof data === 'object' && 'update_id' in data;
  }

  /**
   * Send message
   */
  static async sendMessage(
    credentials: string,
    chatId: number | string,
    text: string,
    parseMode: 'HTML' | 'Markdown' | 'MarkdownV2' = 'HTML'
  ): Promise<void> {
    const decrypted = decryptObject(credentials);

    await axios.post(
      `https://api.telegram.org/bot${decrypted.bot_token}/sendMessage`,
      {
        chat_id: chatId,
        text,
        parse_mode: parseMode,
      }
    );
  }

  /**
   * Send message with inline keyboard
   */
  static async sendMessageWithKeyboard(
    credentials: string,
    chatId: number | string,
    text: string,
    buttons: Array<Array<{ text: string; callback_data: string }>>
  ): Promise<void> {
    const decrypted = decryptObject(credentials);

    await axios.post(
      `https://api.telegram.org/bot${decrypted.bot_token}/sendMessage`,
      {
        chat_id: chatId,
        text,
        reply_markup: {
          inline_keyboard: buttons,
        },
      }
    );
  }

  /**
   * Get updates (for testing without webhook)
   */
  static async getUpdates(credentials: string, offset?: number): Promise<any[]> {
    const decrypted = decryptObject(credentials);

    const response = await axios.get(
      `https://api.telegram.org/bot${decrypted.bot_token}/getUpdates`,
      {
        params: { offset, timeout: 30 },
      }
    );

    return response.data.result;
  }
}
