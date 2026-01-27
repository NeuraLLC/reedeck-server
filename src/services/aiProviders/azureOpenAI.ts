/**
 * Azure OpenAI Provider
 *
 * Enterprise-safe AI with:
 * - Zero data retention
 * - Private VPC deployment
 * - SOC 2 / ISO 27001 compliance
 */

import axios from 'axios';
import { AIProvider, AIProviderConfig, AIMessage, AIResponse } from './index';
import logger from '../../config/logger';

export class AzureOpenAIProvider implements AIProvider {
  readonly type = 'azure-openai' as const;
  private apiKey: string;
  private endpoint: string;
  private deploymentName: string;
  private apiVersion: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: AIProviderConfig) {
    this.apiKey = config.apiKey || process.env.AZURE_OPENAI_API_KEY || '';
    this.endpoint = config.endpoint || process.env.AZURE_OPENAI_ENDPOINT || '';
    this.deploymentName = config.deploymentName || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4';
    this.apiVersion = '2024-02-15-preview';
    this.temperature = config.temperature ?? 0.3;
    this.maxTokens = config.maxTokens ?? 2048;

    if (!this.apiKey || !this.endpoint) {
      logger.warn('Azure OpenAI not fully configured - API key or endpoint missing');
    }
  }

  async generateResponse(messages: AIMessage[], config?: Partial<AIProviderConfig>): Promise<AIResponse> {
    try {
      const url = `${this.endpoint}/openai/deployments/${config?.deploymentName || this.deploymentName}/chat/completions?api-version=${this.apiVersion}`;

      const response = await axios.post(
        url,
        {
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          temperature: config?.temperature ?? this.temperature,
          max_tokens: config?.maxTokens ?? this.maxTokens,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'api-key': this.apiKey,
          },
        }
      );

      const data = response.data;
      const choice = data.choices[0];

      return {
        content: choice.message.content,
        model: data.model,
        provider: 'azure-openai',
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      logger.error('Azure OpenAI API error:', error);
      if (axios.isAxiosError(error)) {
        throw new Error(`Azure OpenAI API error: ${error.response?.data?.error?.message || error.message}`);
      }
      throw new Error(`Azure OpenAI API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey || !this.endpoint) {
      return false;
    }

    try {
      const url = `${this.endpoint}/openai/deployments/${this.deploymentName}/chat/completions?api-version=${this.apiVersion}`;

      await axios.post(
        url,
        {
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 5,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'api-key': this.apiKey,
          },
          timeout: 5000,
        }
      );

      return true;
    } catch {
      return false;
    }
  }
}
