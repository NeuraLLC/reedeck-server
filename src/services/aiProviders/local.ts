/**
 * Local/On-Premises AI Provider (Ollama)
 *
 * Full data sovereignty - no data leaves the organization's infrastructure.
 * Supports open-source models like:
 * - Llama 3
 * - Mistral
 * - Mixtral
 * - CodeLlama
 */

import axios from 'axios';
import { AIProvider, AIProviderConfig, AIMessage, AIResponse } from './index';
import logger from '../../config/logger';

export class LocalProvider implements AIProvider {
  readonly type = 'local' as const;
  private baseUrl: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: AIProviderConfig) {
    this.baseUrl = config.endpoint || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.model = config.model || process.env.OLLAMA_MODEL || 'llama3';
    this.temperature = config.temperature ?? 0.3;
    this.maxTokens = config.maxTokens ?? 2048;
  }

  async generateResponse(messages: AIMessage[], config?: Partial<AIProviderConfig>): Promise<AIResponse> {
    try {
      const model = config?.model || this.model;

      // Convert messages to Ollama chat format
      const response = await axios.post(
        `${this.baseUrl}/api/chat`,
        {
          model,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          stream: false,
          options: {
            temperature: config?.temperature ?? this.temperature,
            num_predict: config?.maxTokens ?? this.maxTokens,
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 120000, // 2 minutes - local models can be slow
        }
      );

      const data = response.data;

      return {
        content: data.message?.content || '',
        model,
        provider: 'local',
        usage: {
          promptTokens: data.prompt_eval_count || 0,
          completionTokens: data.eval_count || 0,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
        },
      };
    } catch (error) {
      logger.error('Local AI (Ollama) error:', error);
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED') {
          throw new Error('Local AI server (Ollama) is not running. Please start Ollama first.');
        }
        throw new Error(`Local AI error: ${error.response?.data?.error || error.message}`);
      }
      throw new Error(`Local AI error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/tags`, {
        timeout: 5000,
      });

      // Check if the configured model is available
      const models = response.data?.models || [];
      const hasModel = models.some((m: any) => m.name === this.model || m.name.startsWith(this.model));

      if (!hasModel) {
        logger.warn(`Model '${this.model}' not found in Ollama. Available: ${models.map((m: any) => m.name).join(', ')}`);
      }

      return true; // Server is running even if model isn't pulled yet
    } catch {
      return false;
    }
  }

  /**
   * List available models on the local Ollama server
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/tags`, {
        timeout: 5000,
      });

      return (response.data?.models || []).map((m: any) => m.name);
    } catch (error) {
      logger.error('Failed to list Ollama models:', error);
      return [];
    }
  }

  /**
   * Pull a model from Ollama registry
   */
  async pullModel(modelName: string): Promise<void> {
    try {
      await axios.post(
        `${this.baseUrl}/api/pull`,
        { name: modelName },
        { timeout: 600000 } // 10 minutes for large models
      );
    } catch (error) {
      logger.error(`Failed to pull model '${modelName}':`, error);
      throw error;
    }
  }
}
