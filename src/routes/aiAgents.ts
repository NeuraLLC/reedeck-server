import { Router } from 'express';
import crypto from 'crypto';
import { Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { attachOrganization, requireAdmin } from '../middleware/organization';
import { checkSubscriptionLimits } from '../middleware/rateLimit';
import { aiChatLimiter } from '../middleware/security';
import { AuthRequest } from '../types';
import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import geminiService from '../services/geminiService';

const router = Router();

router.use(authenticate);
router.use(attachOrganization);

// Get all AI agents
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const agents = await prisma.aiAgent.findMany({
      where: {
        organizationId: req.organizationId,
      },
      include: {
        sources: {
          select: {
            id: true,
            sourceType: true,
            sourceId: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(agents);
  } catch (error) {
    next(error);
  }
});

// Get single AI agent
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const agent = await prisma.aiAgent.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId,
      },
      include: {
        sources: true,
      },
    });

    if (!agent) {
      throw new AppError('AI agent not found', 404);
    }

    res.json(agent);
  } catch (error) {
    next(error);
  }
});

// Create AI agent
router.post(
  '/',
  requireAdmin,
  checkSubscriptionLimits('aiAgents'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { name, description, systemPrompt, temperature } = req.body;

      const agent = await prisma.aiAgent.create({
        data: {
          organizationId: req.organizationId!,
          name,
          description,
          systemPrompt,
          model: 'gemini-1.5-pro', // Enforce Gemini
          temperature: temperature || 0.7,
        },
      });

      res.status(201).json(agent);
    } catch (error) {
      next(error);
    }
  }
);

// Update AI agent
router.patch(
  '/:id',
  requireAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { name, description, systemPrompt, temperature, isActive } = req.body;

      const agent = await prisma.aiAgent.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.organizationId,
        },
      });

      if (!agent) {
        throw new AppError('AI agent not found', 404);
      }

      const updated = await prisma.aiAgent.update({
        where: { id: req.params.id },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
          ...(systemPrompt && { systemPrompt }),
          ...(temperature !== undefined && { temperature }),
          ...(isActive !== undefined && { isActive }),
        },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// Delete AI agent
router.delete(
  '/:id',
  requireAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const agent = await prisma.aiAgent.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.organizationId,
        },
      });

      if (!agent) {
        throw new AppError('AI agent not found', 404);
      }

      await prisma.aiAgent.delete({
        where: { id: req.params.id },
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// Chat with AI agent
router.post(
  '/:id/chat',
  aiChatLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { message, sessionId } = req.body;

      const agent = await prisma.aiAgent.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.organizationId,
          isActive: true,
        },
      });

      if (!agent) {
        throw new AppError('AI agent not found or inactive', 404);
      }

      // 1. Generate embedding for the user's query
      const queryEmbedding = await geminiService.generateQueryEmbedding(message);

      // 2. Search for relevant context using vector similarity
      const vectorQuery = `[${queryEmbedding.join(',')}]`;
      const relevantChunks = await prisma.$queryRaw`
        SELECT content, 1 - (embedding <=> ${vectorQuery}::vector) as similarity
        FROM agent_embeddings
        WHERE source_id IN (SELECT id FROM agent_sources WHERE agent_id = ${agent.id})
        ORDER BY embedding <=> ${vectorQuery}::vector
        LIMIT 5;
      ` as any[];

      const contextText = relevantChunks.map((chunk: any) => chunk.content).join('\n---\n');

      // 3. Get or create conversation history
      let conversation = await prisma.agentConversation.findFirst({
        where: {
          agentId: agent.id,
          sessionId,
        },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!conversation) {
        conversation = await prisma.agentConversation.create({
          data: {
            agentId: agent.id,
            sessionId,
          },
          include: {
            messages: true,
          },
        });
      }

      // 4. Save user message
      await prisma.agentMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'user',
          content: message,
        },
      });

      // 5. Prepare system prompt with context
      const augmentedSystemPrompt = `
${agent.systemPrompt}

You have access to the following knowledge base connection. Use it to answer the user's questions. 
If the answer is not in the context, say you don't know, but try to be helpful based on the context provided.

Context:
${contextText}
`;

      // 6. Generate response using Gemini
      // Map existing messages to Gemini format
      const history = conversation.messages.map(m => ({
        role: m.role as 'user' | 'model' | 'assistant',
        parts: m.content
      }));

      const assistantMessage = await geminiService.generateChatResponse(
        augmentedSystemPrompt,
        history,
        message,
        agent.temperature
      );

      // 7. Save assistant message
      await prisma.agentMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'assistant',
          content: assistantMessage,
        },
      });

      res.json({
        message: assistantMessage,
        conversationId: conversation.id,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Train AI agent
router.post(
  '/:id/train',
  requireAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const agent = await prisma.aiAgent.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.organizationId,
        },
        include: {
          sources: {
            include: {
              _count: {
                select: { embeddings: true },
              },
            },
          },
        },
      });

      if (!agent) {
        throw new AppError('AI agent not found', 404);
      }

      // Optimized approach: 
      // 1. Iterate through sources
      // 2. If source is static (file/text) and has embeddings, skip
      // 3. If source is dynamic (website) or has no embeddings, process it

      let processedCount = 0;
      let skippedCount = 0;

      for (const source of agent.sources) {
        // Check if we should skip this source
        const isDynamic = source.sourceType === 'website';
        const hasEmbeddings = source._count.embeddings > 0;

        // If it's a static source and already has embeddings, strictly skip it to save resources
        if (!isDynamic && hasEmbeddings) {
          skippedCount++;
          continue;
        }

        // Processing...
        let contentToEmbed = '';

        if (source.sourceType === 'website') {
          // Fetch content from URL
          contentToEmbed = await geminiService.processUrl(source.content);
        } else {
          // File, Text, Q&A - use content directly
          contentToEmbed = source.content;
        }

        if (!contentToEmbed) {
            skippedCount++;
            continue;
        }

        // Clear existing embeddings for THIS source before re-populating
        // This handles cases where we are retraining a website or a text source that (hypothetically) changed
        if (hasEmbeddings) {
            await prisma.agentEmbedding.deleteMany({
                where: { sourceId: source.id }
            });
        }

        // Chunk the content
        const chunks = geminiService.chunkText(contentToEmbed);

        // Generate embeddings for each chunk and save
        for (const chunk of chunks) {
          const embedding = await geminiService.generateEmbedding(chunk);

          // Use raw query to insert vector data
          await prisma.$executeRaw`
            INSERT INTO agent_embeddings (id, source_id, content, embedding, metadata, created_at)
            VALUES (
              ${crypto.randomUUID()},
              ${source.id},
              ${chunk},
              ${embedding}::vector,
              '{}'::jsonb,
              NOW()
            )
          `;
        }
        processedCount++;
      }

      await prisma.aiAgent.update({
        where: { id: req.params.id },
        data: {
          updatedAt: new Date(),
        },
      });

      res.json({
        success: true,
        message: 'Agent training completed',
        processedSources: processedCount,
        skippedSources: skippedCount,
        trainedAt: new Date(),
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get agent training status
router.get('/:id/status', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const agent = await prisma.aiAgent.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId,
      },
      select: {
        id: true,
        isActive: true,
        updatedAt: true,
        _count: {
          select: {
            sources: true,
          },
        },
      },
    });

    if (!agent) {
      throw new AppError('AI agent not found', 404);
    }

    res.json({
      id: agent.id,
      isActive: agent.isActive,
      lastUpdated: agent.updatedAt,
      sourcesCount: agent._count.sources,
      status: agent.isActive ? 'active' : 'inactive',
    });
  } catch (error) {
    next(error);
  }
});

// Upload training sources (Files, URLs, Text, etc.)
router.post(
  '/:id/sources',
  requireAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { type, content, metadata } = req.body;
      // type: 'file', 'text', 'website', 'qna'

      const agent = await prisma.aiAgent.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.organizationId,
        },
      });

      if (!agent) {
        throw new AppError('AI agent not found', 404);
      }

      const source = await prisma.agentSource.create({
        data: {
          agentId: req.params.id,
          sourceType: type,
          sourceId: `${type}_${Date.now()}`,
          content: content, // For website, this is the URL. For file/text, actual content.
          metadata: metadata || {},
        },
      });

      res.status(201).json(source);
    } catch (error) {
      next(error);
    }
  }
);

// Delete source
router.delete(
  '/:id/sources/:sourceId',
  requireAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const agent = await prisma.aiAgent.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.organizationId,
        },
      });

      if (!agent) {
        throw new AppError('AI agent not found', 404);
      }

      const source = await prisma.agentSource.findFirst({
        where: {
          id: req.params.sourceId,
          agentId: req.params.id,
        },
      });

      if (!source) {
        throw new AppError('Source not found', 404);
      }

      await prisma.agentSource.delete({
        where: { id: req.params.sourceId },
      });

      res.json({ success: true, message: 'Source deleted successfully' });
    } catch (error) {
      next(error);
    }
  }
);


// Keep legacy file upload endpoint for backward compatibility if needed, 
// or redirect logic to new source endpoint. 
// For now, I'll update it to use the unified source structure.
router.post(
  '/:id/files/upload',
  requireAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { fileName, fileType, fileContent, fileSize } = req.body;

      const agent = await prisma.aiAgent.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.organizationId,
        },
      });

      if (!agent) {
        throw new AppError('AI agent not found', 404);
      }

      // Create source record for the file
      const source = await prisma.agentSource.create({
        data: {
          agentId: req.params.id,
          sourceType: 'file',
          sourceId: `file_${Date.now()}`,
          content: fileContent,
          metadata: {
            fileName,
            fileType,
            fileSize,
          },
        },
      });

      res.status(201).json(source);
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  '/:id/files/:fileId',
  requireAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
     // Reusing the source deletion logic by redirecting or logic duplicating
     // Since fileId is the DB ID in the legacy path, it's the same.
     try {
      const agent = await prisma.aiAgent.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.organizationId,
        },
      });

      if (!agent) {
        throw new AppError('AI agent not found', 404);
      }

      await prisma.agentSource.delete({
        where: { id: req.params.fileId },
      });

      res.json({ success: true, message: 'File deleted successfully' });
    } catch (error) {
      next(error);
    }
  }
);

// Get conversations (unchanged mostly)
router.get('/:id/conversations', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const agent = await prisma.aiAgent.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId,
      },
    });

    if (!agent) {
      throw new AppError('AI agent not found', 404);
    }

    const conversations = await prisma.agentConversation.findMany({
      where: {
        agentId: req.params.id,
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 1, 
        },
        _count: {
          select: { messages: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(conversations);
  } catch (error) {
    next(error);
  }
});

router.delete(
  '/:id/conversations/:conversationId',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const agent = await prisma.aiAgent.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.organizationId,
        },
      });

      if (!agent) {
        throw new AppError('AI agent not found', 404);
      }

      await prisma.agentConversation.delete({
        where: { id: req.params.conversationId },
      });

      res.json({ success: true, message: 'Conversation deleted successfully' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
