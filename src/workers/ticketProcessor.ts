import { Job } from 'bull';
import { ticketProcessingQueue } from '../config/queue';
import autonomousAIService from '../services/autonomousAIService';
import prisma from '../config/database';
import logger from '../config/logger';
import { sendResponseToSource } from '../services/channelRelay';

interface TicketProcessingJob {
  ticketId: string;
  organizationId: string;
}

/**
 * Process a ticket with autonomous AI
 * This runs in the background to avoid blocking the API request
 */
ticketProcessingQueue.process(async (job: Job<TicketProcessingJob>) => {
  const { ticketId, organizationId } = job.data;

  logger.info(`Processing ticket ${ticketId} with autonomous AI`);

  try {
    // Process ticket with AI
    const result = await autonomousAIService.processTicket(ticketId, organizationId);

    // If AI can respond, create the response
    if (result.shouldRespond && result.response) {
      // Save AI response to database
      await prisma.ticketMessage.create({
        data: {
          ticketId,
          senderType: 'system',
          content: result.response,
          isInternal: false,
        },
      });

      // Send the response back to the customer via the original channel (Slack/Gmail/etc.)
      const sent = await sendResponseToSource(ticketId, result.response);

      if (!sent) {
        logger.warn(`Failed to send auto-response to source for ticket ${ticketId}, but response saved to DB`);
      }

      // Update ticket status
      await prisma.ticket.update({
        where: { id: ticketId },
        data: {
          status: 'closed',
          closedAt: new Date(),
        },
      });

      logger.info(`Ticket ${ticketId} auto-resolved by AI with confidence ${result.confidence}, sent: ${sent}`);
    } else if (result.shouldAssignToAgent && result.assignedAgentId) {
      // Assign to team member
      await prisma.ticket.update({
        where: { id: ticketId },
        data: {
          assignedTo: result.assignedAgentId,
          status: 'in_progress',
        },
      });

      logger.info(`Ticket ${ticketId} assigned to agent ${result.assignedAgentId} (confidence: ${result.confidence})`);

      // TODO: Send notification to assigned agent
    }

    return {
      success: true,
      result,
      ticketId,
    };
  } catch (error) {
    logger.error(`Error processing ticket ${ticketId}:`, error);
    throw error; // Will trigger retry
  }
});

// Error handler
ticketProcessingQueue.on('error', (error) => {
  logger.error('Ticket processing queue error:', error);
});

// Failed job handler
ticketProcessingQueue.on('failed', (job, error) => {
  logger.error(`Ticket processing job ${job.id} failed:`, error);
});

// Completed job handler
ticketProcessingQueue.on('completed', (job, result) => {
  logger.info(`Ticket processing job ${job.id} completed successfully`);
});

logger.info('Ticket processing worker started');

export default ticketProcessingQueue;
