/**
 * AI Provider Abstraction Layer
 *
 * Supports multiple AI providers for enterprise compliance:
 * - Gemini (Google) - Default
 * - Azure OpenAI - Enterprise-safe, zero retention
 * - Local/On-Prem (Ollama) - Full data sovereignty
 */

export type AIProviderType = 'gemini' | 'azure-openai' | 'local';

export interface AIProviderConfig {
  type: AIProviderType;
  apiKey?: string;
  endpoint?: string;
  model?: string;
  deploymentName?: string; // For Azure
  temperature?: number;
  maxTokens?: number;
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  provider: AIProviderType;
}

export interface AIProvider {
  readonly type: AIProviderType;
  generateResponse(messages: AIMessage[], config?: Partial<AIProviderConfig>): Promise<AIResponse>;
  isAvailable(): Promise<boolean>;
}

// Re-export providers
export { GeminiProvider } from './gemini';
export { AzureOpenAIProvider } from './azureOpenAI';
export { LocalProvider } from './local';

// Factory function
import { GeminiProvider } from './gemini';
import { AzureOpenAIProvider } from './azureOpenAI';
import { LocalProvider } from './local';

export function createAIProvider(config: AIProviderConfig): AIProvider {
  switch (config.type) {
    case 'gemini':
      return new GeminiProvider(config);
    case 'azure-openai':
      return new AzureOpenAIProvider(config);
    case 'local':
      return new LocalProvider(config);
    default:
      throw new Error(`Unknown AI provider type: ${config.type}`);
  }
}

// Default provider based on environment
export function getDefaultProvider(): AIProvider {
  // Check which provider is configured
  if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT) {
    return new AzureOpenAIProvider({
      type: 'azure-openai',
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT,
    });
  }

  if (process.env.OLLAMA_BASE_URL) {
    return new LocalProvider({
      type: 'local',
      endpoint: process.env.OLLAMA_BASE_URL,
      model: process.env.OLLAMA_MODEL || 'llama3',
    });
  }

  // Default to Gemini
  return new GeminiProvider({
    type: 'gemini',
    apiKey: process.env.GEMINI_API_KEY,
  });
}
