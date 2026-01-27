/**
 * Google Gemini AI Provider
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIProvider, AIProviderConfig, AIMessage, AIResponse } from './index';
import logger from '../../config/logger';

export class GeminiProvider implements AIProvider {
  readonly type = 'gemini' as const;
  private client: GoogleGenerativeAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: AIProviderConfig) {
    const apiKey = config.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }

    this.client = new GoogleGenerativeAI(apiKey);
    this.model = config.model || 'gemini-pro';
    this.temperature = config.temperature ?? 0.3;
    this.maxTokens = config.maxTokens ?? 2048;
  }

  async generateResponse(messages: AIMessage[], config?: Partial<AIProviderConfig>): Promise<AIResponse> {
    try {
      const model = this.client.getGenerativeModel({
        model: config?.model || this.model,
        generationConfig: {
          temperature: config?.temperature ?? this.temperature,
          maxOutputTokens: config?.maxTokens ?? this.maxTokens,
        },
      });

      // Convert messages to Gemini format
      const systemMessage = messages.find(m => m.role === 'system');
      const conversationMessages = messages.filter(m => m.role !== 'system');

      // Build the prompt
      let prompt = '';
      if (systemMessage) {
        prompt = `${systemMessage.content}\n\n`;
      }

      for (const msg of conversationMessages) {
        if (msg.role === 'user') {
          prompt += `User: ${msg.content}\n`;
        } else if (msg.role === 'assistant') {
          prompt += `Assistant: ${msg.content}\n`;
        }
      }

      const result = await model.generateContent(prompt);
      const response = result.response;
      const text = response.text();

      return {
        content: text,
        model: config?.model || this.model,
        provider: 'gemini',
        usage: {
          promptTokens: 0, // Gemini doesn't provide token counts in the same way
          completionTokens: 0,
          totalTokens: 0,
        },
      };
    } catch (error) {
      logger.error('Gemini API error:', error);
      throw new Error(`Gemini API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const model = this.client.getGenerativeModel({ model: this.model });
      await model.generateContent('test');
      return true;
    } catch {
      return false;
    }
  }
}
