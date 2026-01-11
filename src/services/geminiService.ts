import { TaskType } from '@google/generative-ai';
import { AppError } from '../middleware/errorHandler';
import genAI from '../config/gemini';
import axios from 'axios';
import * as cheerio from 'cheerio';

export class GeminiService {
  private model: any;
  private embeddingModel: any;

  constructor() {
    this.model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
    this.embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
  }

  /**
   * Generate embeddings for a given text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const result = await this.embeddingModel.embedContent({
        content: { parts: [{ text }] },
        taskType: TaskType.RETRIEVAL_DOCUMENT,
      });

      return result.embedding.values;
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw new AppError('Failed to generate embedding', 500);
    }
  }

  /**
   * Generate embedding for a query (optimized for retrieval)
   */
  async generateQueryEmbedding(text: string): Promise<number[]> {
    try {
      const result = await this.embeddingModel.embedContent({
        content: { parts: [{ text }] },
        taskType: TaskType.RETRIEVAL_QUERY,
      });

      return result.embedding.values;
    } catch (error) {
      console.error('Error generating query embedding:', error);
      throw new AppError('Failed to generate query embedding', 500);
    }
  }

  /**
   * Generate a chat response using Gemini
   */
  async generateChatResponse(
    systemPrompt: string,
    history: { role: 'user' | 'model' | 'assistant'; parts: string }[],
    message: string,
    temperature: number = 0.7
  ): Promise<string> {
    try {
      const chat = this.model.startChat({
        history: [
          {
            role: 'user',
            parts: [{ text: `System Instruction: ${systemPrompt}` }],
          },
          ...history.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : msg.role, // Map 'assistant' to 'model' for Gemini
            parts: [{ text: msg.parts }],
          })),
        ],
        generationConfig: {
          temperature,
        },
      });

      const result = await chat.sendMessage(message);
      const response = result.response;
      return response.text();
    } catch (error) {
      console.error('Error generating chat response:', error);
      throw new AppError('Failed to generate chat response', 500);
    }
  }


  /**
   * Fetch and clean text content from a URL
   */
  async processUrl(url: string): Promise<string> {
    try {
      const response = await axios.get(url);
      const html = response.data;
      const $ = cheerio.load(html);

      // Remove script types, styles, and other non-content elements
      $('script').remove();
      $('style').remove();
      $('nav').remove();
      $('footer').remove();
      $('header').remove();

      // Get text
      const text = $('body').text();
      
      // Clean up whitespace
      return text.replace(/\s+/g, ' ').trim();
    } catch (error) {
      console.error('Error fetching URL:', error);
      throw new AppError('Failed to process website source', 400);
    }
  }

  /**
   * Chunk text into smaller segments for embedding
   */
  chunkText(text: string, maxChunkSize: number = 1000): string[] {
    const chunks: string[] = [];
    let currentChunk = '';

    // Split by sentences (rough approximation)
    const sentences = text.match(/[^.!?]+[.!?]+|\s+/g) || [text];

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      currentChunk += sentence;
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }
}

export default new GeminiService();
