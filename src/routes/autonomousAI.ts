import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { attachOrganization, requireAdmin } from '../middleware/organization';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import autonomousAIService from '../services/autonomousAIService';
import { ticketProcessingQueue, recurringIssueQueue } from '../config/queue';

const router = Router();

router.use(authenticate);
router.use(attachOrganization);

// Get autonomous AI settings
router.get('/settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.organizationId! },
      select: {
        settings: true,
      },
    });

    const aiSettings = (organization?.settings as any)?.autonomousAI || {
      enabled: false,
      autoResponseEnabled: false,
      confidenceThreshold: 0.7,
      assignmentStrategy: 'round-robin', // round-robin, least-busy, specialized
      recurringIssueDetection: false,
      autoCreateTasks: false,
      taskPlatform: null, // 'clickup' or 'asana'
      minimumOccurrences: 3,
      taskAssignmentStrategy: 'auto', // auto, manual
    };

    res.json(aiSettings);
  } catch (error) {
    next(error);
  }
});

// Update autonomous AI settings
router.patch('/settings', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      enabled,
      autoResponseEnabled,
      confidenceThreshold,
      assignmentStrategy,
      recurringIssueDetection,
      autoCreateTasks,
      taskPlatform,
      minimumOccurrences,
      taskAssignmentStrategy,
    } = req.body;

    const organization = await prisma.organization.findUnique({
      where: { id: req.organizationId! },
    });

    if (!organization) {
      throw new AppError('Organization not found', 404);
    }

    const currentSettings = (organization.settings as any) || {};
    const updatedAISettings = {
      ...currentSettings.autonomousAI,
      ...(enabled !== undefined && { enabled }),
      ...(autoResponseEnabled !== undefined && { autoResponseEnabled }),
      ...(confidenceThreshold !== undefined && { confidenceThreshold }),
      ...(assignmentStrategy && { assignmentStrategy }),
      ...(recurringIssueDetection !== undefined && { recurringIssueDetection }),
      ...(autoCreateTasks !== undefined && { autoCreateTasks }),
      ...(taskPlatform !== undefined && { taskPlatform }),
      ...(minimumOccurrences !== undefined && { minimumOccurrences }),
      ...(taskAssignmentStrategy && { taskAssignmentStrategy }),
      ...(req.body.supportAgentId !== undefined && { supportAgentId: req.body.supportAgentId }),
    };

    const updated = await prisma.organization.update({
      where: { id: req.organizationId! },
      data: {
        settings: {
          ...currentSettings,
          autonomousAI: updatedAISettings,
        },
      },
    });

    res.json(updatedAISettings);
  } catch (error) {
    next(error);
  }
});

// Process a ticket with autonomous AI (async with background job)
router.post('/process-ticket/:ticketId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { ticketId } = req.params;

    // Add job to queue for background processing
    const job = await ticketProcessingQueue.add({
      ticketId,
      organizationId: req.organizationId!,
    });

    res.json({
      success: true,
      message: 'Ticket processing job queued',
      jobId: job.id,
    });
  } catch (error) {
    next(error);
  }
});

// Detect recurring issues (immediate - for testing/debugging)
router.get('/recurring-issues', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const issues = await autonomousAIService.detectRecurringIssues(req.organizationId!);

    res.json({ issues });
  } catch (error) {
    next(error);
  }
});

// Trigger recurring issues detection as background job (recommended for production)
router.post('/detect-recurring-issues', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { autoCreateTasks = false } = req.body;

    // Add job to queue for background processing
    const job = await recurringIssueQueue.add({
      organizationId: req.organizationId!,
      autoCreateTasks,
    });

    res.json({
      success: true,
      message: 'Recurring issue detection job queued',
      jobId: job.id,
    });
  } catch (error) {
    next(error);
  }
});

// Create task for recurring issue
router.post('/create-task', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { issue, platform, assigneeId } = req.body;

    if (!issue) {
      throw new AppError('Issue data is required', 400);
    }

    let task;

    if (platform === 'clickup' || platform === 'ClickUp') {
      task = await autonomousAIService.createClickUpTask(
        req.organizationId!,
        issue,
        assigneeId
      );
    } else if (platform === 'asana' || platform === 'Asana') {
      task = await autonomousAIService.createAsanaTask(
        req.organizationId!,
        issue,
        assigneeId
      );
    } else {
      throw new AppError('Invalid platform. Must be "clickup" or "asana"', 400);
    }

    res.status(201).json({
      success: true,
      task,
    });
  } catch (error) {
    next(error);
  }
});

// Auto-detect and create tasks for recurring issues
router.post('/auto-create-tasks', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.organizationId! },
    });

    const aiSettings = (organization?.settings as any)?.autonomousAI || {};

    if (!aiSettings.autoCreateTasks) {
      throw new AppError('Auto task creation is not enabled', 400);
    }

    if (!aiSettings.taskPlatform) {
      throw new AppError('Task platform not configured', 400);
    }

    // Detect issues
    const issues = await autonomousAIService.detectRecurringIssues(req.organizationId!);

    // Filter by minimum occurrences
    const significantIssues = issues.filter(
      issue => issue.occurrences >= (aiSettings.minimumOccurrences || 3)
    );

    // Create tasks for each significant issue
    const createdTasks = [];

    for (const issue of significantIssues) {
      let task;

      if (aiSettings.taskPlatform === 'clickup') {
        task = await autonomousAIService.createClickUpTask(
          req.organizationId!,
          issue
        );
      } else if (aiSettings.taskPlatform === 'asana') {
        task = await autonomousAIService.createAsanaTask(
          req.organizationId!,
          issue
        );
      }

      createdTasks.push(task);
    }

    res.json({
      success: true,
      issuesDetected: significantIssues.length,
      tasksCreated: createdTasks.length,
      tasks: createdTasks,
    });
  } catch (error) {
    next(error);
  }
});

// Get autonomous AI statistics
router.get('/stats', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Count tickets handled by AI vs humans
    const totalTickets = await prisma.ticket.count({
      where: {
        organizationId: req.organizationId,
        createdAt: {
          gte: thirtyDaysAgo,
        },
      },
    });

    // Count auto-resolved tickets (closed without human assignment)
    const autoResolvedTickets = await prisma.ticket.count({
      where: {
        organizationId: req.organizationId,
        createdAt: {
          gte: thirtyDaysAgo,
        },
        status: 'closed',
        assignedTo: null,
      },
    });

    // Count tickets assigned to humans
    const humanAssignedTickets = await prisma.ticket.count({
      where: {
        organizationId: req.organizationId,
        createdAt: {
          gte: thirtyDaysAgo,
        },
        assignedTo: {
          not: null,
        },
      },
    });

    // Calculate average resolution time
    const closedTickets = await prisma.ticket.findMany({
      where: {
        organizationId: req.organizationId,
        createdAt: {
          gte: thirtyDaysAgo,
        },
        status: 'closed',
      },
      select: {
        createdAt: true,
        closedAt: true,
      },
    });

    const avgResolutionTime =
      closedTickets.length > 0
        ? closedTickets.reduce((sum, ticket) => {
            if (ticket.closedAt) {
              return sum + (ticket.closedAt.getTime() - ticket.createdAt.getTime());
            }
            return sum;
          }, 0) / closedTickets.length
        : 0;

    res.json({
      totalTickets,
      autoResolvedTickets,
      humanAssignedTickets,
      automationRate: totalTickets > 0 ? (autoResolvedTickets / totalTickets) * 100 : 0,
      avgResolutionTimeHours: avgResolutionTime / (1000 * 60 * 60),
      period: 'last30Days',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
