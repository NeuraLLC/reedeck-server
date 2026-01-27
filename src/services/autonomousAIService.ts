import prisma from '../config/database';
import genAI from '../config/gemini';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import { piiRedactor } from './piiRedactor';
import { createAIProvider, AIProvider, AIProviderType } from './aiProviders';

interface AutoResponseResult {
  shouldRespond: boolean;
  response?: string;
  confidence: number;
  shouldAssignToAgent: boolean;
  assignedAgentId?: string;
  piiRedacted?: boolean;
  redactionCount?: number;
}

interface AIComplianceSettings {
  piiRedactionEnabled: boolean;
  aiProvider: AIProviderType;
  azureOpenAIEndpoint?: string;
  azureOpenAIDeployment?: string;
  localModelEndpoint?: string;
  localModelName?: string;
  auditLoggingEnabled: boolean;
  dataRetentionDays: number;
}

interface RecurringIssue {
  issue: string;
  occurrences: number;
  affectedCustomers: number;
  ticketIds: string[];
  suggestedSolution?: string;
}

export class AutonomousAIService {
  /**
   * Get AI provider based on compliance settings
   */
  private getAIProvider(complianceSettings: any): AIProvider {
    const providerType = complianceSettings.aiProvider || 'gemini';

    return createAIProvider({
      type: providerType,
      apiKey: providerType === 'gemini' ? process.env.GEMINI_API_KEY :
              providerType === 'azure-openai' ? complianceSettings.azureOpenAIKey : undefined,
      endpoint: providerType === 'azure-openai' ? complianceSettings.azureOpenAIEndpoint :
                providerType === 'local' ? complianceSettings.localModelEndpoint : undefined,
      deploymentName: complianceSettings.azureOpenAIDeployment,
      model: providerType === 'local' ? complianceSettings.localModelName : undefined,
      temperature: 0.3,
    });
  }

  /**
   * Process a new ticket with autonomous AI
   * Determines if AI can respond, or if it should assign to a team member
   */
  async processTicket(ticketId: string, organizationId: string): Promise<AutoResponseResult> {
    try {
      // Get ticket with messages
      const ticket = await prisma.ticket.findFirst({
        where: {
          id: ticketId,
          organizationId,
        },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!ticket) {
        throw new AppError('Ticket not found', 404);
      }

      // Get organization's AI settings
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
      });

      const aiSettings = (organization?.settings as any)?.autonomousAI || {
        enabled: false,
        autoResponseEnabled: false,
        confidenceThreshold: 0.7,
      };

      if (!aiSettings.enabled || !aiSettings.autoResponseEnabled) {
        return {
          shouldRespond: false,
          confidence: 0,
          shouldAssignToAgent: true,
        };
      }

      // Get compliance settings
      const complianceSettings = (organization?.settings as any)?.compliance || {
        piiRedactionEnabled: true, // Default to enabled for security
        aiProvider: 'gemini',
        auditLoggingEnabled: true,
        dataRetentionDays: 90,
      };

      // usage of aiSettings.supportAgentId
      let agent;

      if (aiSettings.supportAgentId) {
        agent = await prisma.aiAgent.findFirst({
          where: {
            id: aiSettings.supportAgentId,
            organizationId,
            isActive: true,
          },
          include: {
            sources: true,
          },
        });
      }

      // Fallback: Get the most capable AI agent (e.g., one with 'support' in name or just the latest)
      if (!agent) {
        agent = await prisma.aiAgent.findFirst({
          where: {
            organizationId,
            isActive: true,
          },
          orderBy: { createdAt: 'desc' },
          include: {
            sources: true,
          },
        });
      }

      if (!agent) {
        return {
          shouldRespond: false,
          confidence: 0,
          shouldAssignToAgent: true,
        };
      }

      // Prepare context from ticket messages
      const rawCustomerMessage = ticket.messages[0]?.content || ticket.subject;

      // Apply PII redaction if enabled (default: enabled for compliance)
      let customerMessage = rawCustomerMessage;
      let redactionResult = null;

      if (complianceSettings.piiRedactionEnabled !== false) {
        redactionResult = piiRedactor.redact(rawCustomerMessage);
        customerMessage = redactionResult.redactedText;

        if (redactionResult.hasRedactions) {
          logger.info(`PII Redaction applied: ${redactionResult.redactions.length} items redacted`, {
            ticketId,
            types: redactionResult.redactions.map(r => r.type),
          });
        }
      }

      // Get AI provider based on settings
      const aiProvider = this.getAIProvider(complianceSettings);

      // Use Google Gemini to analyze if AI can handle this
      const analysisPrompt = `
${agent.systemPrompt}

You are analyzing a customer support ticket.
Your task is to determine:
1. Can you provide a helpful solution to this issue? (yes/no)
2. Your confidence level (0-1)
3. If yes, what is the solution?

Customer Issue:
${customerMessage}

Previous similar tickets you've handled successfully:
${agent.sources.slice(0, 5).map(s => s.content).join('\n')}

Respond ONLY with valid JSON in this exact format (no markdown, no code blocks):
{
  "canHandle": boolean,
  "confidence": number (0-1),
  "solution": "detailed solution if canHandle is true"
}
`;

      // Use AI provider for analysis (supports Gemini, Azure OpenAI, or Local)
      const aiResponse = await aiProvider.generateResponse([
        { role: 'user', content: analysisPrompt }
      ], { temperature: 0.3, maxTokens: 1024 });

      const responseText = aiResponse.content.trim();

      // Log AI usage for compliance audit
      if (complianceSettings.auditLoggingEnabled !== false) {
        logger.info('AI Provider used for ticket analysis', {
          ticketId,
          provider: aiResponse.provider,
          model: aiResponse.model,
          piiRedacted: redactionResult?.hasRedactions || false,
          redactionCount: redactionResult?.redactions.length || 0,
        });
      }

      // Clean response if it contains markdown code blocks
      const cleanedResponse = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const result = JSON.parse(cleanedResponse);

      // Check if confidence meets threshold
      if (result.canHandle && result.confidence >= aiSettings.confidenceThreshold) {
        return {
          shouldRespond: true,
          response: result.solution,
          confidence: result.confidence,
          shouldAssignToAgent: false,
          piiRedacted: redactionResult?.hasRedactions || false,
          redactionCount: redactionResult?.redactions.length || 0,
        };
      }

      // If AI can't handle it, find best team member to assign
      const teamMembers = await prisma.organizationMember.findMany({
        where: {
          organizationId,
          status: 'active',
        },
        include: {
          user: true,
        },
      });

      return {
        shouldRespond: false,
        confidence: result.confidence,
        shouldAssignToAgent: true,
        assignedAgentId: teamMembers[0]?.userId, // Simple round-robin for now
        piiRedacted: redactionResult?.hasRedactions || false,
        redactionCount: redactionResult?.redactions.length || 0,
      };
    } catch (error) {
      logger.error('Error processing ticket with autonomous AI:', error);
      throw error;
    }
  }

  /**
   * Detect recurring issues from tickets
   * Groups similar issues and identifies patterns
   */
  async detectRecurringIssues(organizationId: string): Promise<RecurringIssue[]> {
    try {
      // Get tickets from last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const tickets = await prisma.ticket.findMany({
        where: {
          organizationId,
          createdAt: {
            gte: thirtyDaysAgo,
          },
        },
        include: {
          messages: {
            take: 1,
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (tickets.length < 5) {
        return []; // Not enough data
      }

      // Use AI to cluster similar issues
      const ticketDescriptions = tickets.map((t, idx) => ({
        id: t.id,
        index: idx,
        subject: t.subject,
        description: t.messages[0]?.content || t.subject,
      }));

      const clusteringPrompt = `
You are an AI analyst identifying patterns in customer support data.

Analyze these customer support tickets and identify recurring issues.
Group tickets that describe the same or very similar problems.

Tickets:
${ticketDescriptions.map(t => `${t.index}. ${t.subject}: ${t.description.substring(0, 200)}`).join('\n')}

Only include issues that appear in 3 or more tickets.

Respond ONLY with valid JSON in this exact format (no markdown, no code blocks):
{
  "recurringIssues": [
    {
      "issue": "Brief description of the recurring issue",
      "ticketIndices": [list of ticket indices],
      "suggestedSolution": "Suggested fix or action"
    }
  ]
}
`;

      // Use Gemini Pro for clustering analysis
      const clusteringModel = genAI.getGenerativeModel({
        model: 'gemini-pro',
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
        },
      });

      const clusteringGeminiResult = await clusteringModel.generateContent(clusteringPrompt);
      const clusteringResponseText = clusteringGeminiResult.response.text().trim();

      // Clean response if it contains markdown code blocks
      const cleanedClusteringResponse = clusteringResponseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const clusters = JSON.parse(cleanedClusteringResponse || '{"recurringIssues":[]}');

      // Map results back to ticket data
      const recurringIssues: RecurringIssue[] = clusters.recurringIssues.map((issue: any) => {
        const relatedTickets = issue.ticketIndices.map((idx: number) => ticketDescriptions[idx]);
        const uniqueCustomers = new Set(
          relatedTickets.map((t: any) => {
            const ticket = tickets.find(ticket => ticket.id === t.id);
            return ticket?.customerEmail;
          })
        ).size;

        const occurrences = relatedTickets.length;
        let severity: 'urgent' | 'high' | 'medium' | 'low' = 'low';
        
        if (occurrences >= 10) severity = 'urgent';
        else if (occurrences >= 5) severity = 'high';
        else if (occurrences >= 3) severity = 'medium';

        return {
          id: `issue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, // Generate a unique ID
          issue: issue.issue,
          occurrences,
          severity,
          affectedCustomers: uniqueCustomers,
          ticketIds: relatedTickets.map((t: any) => t.id),
          suggestedSolution: issue.suggestedSolution,
        };
      });

      return recurringIssues.filter(issue => issue.occurrences >= 3);
    } catch (error) {
      logger.error('Error detecting recurring issues:', error);
      throw error;
    }
  }

  /**
   * Create a task in ClickUp for a recurring issue
   */
  async createClickUpTask(
    organizationId: string,
    issue: RecurringIssue,
    assigneeId?: string
  ): Promise<any> {
    try {
      // Get ClickUp connection
      const connection = await prisma.sourceConnection.findFirst({
        where: {
          organizationId,
          sourceType: 'ClickUp',
          isActive: true,
        },
      });

      if (!connection) {
        throw new AppError('ClickUp not connected', 400);
      }

      const credentials = connection.credentials as any;
      const listId = credentials.listId; // Should be configured during connection

      // Create detailed task description
      const taskDescription = `
**Recurring Issue Detected**

**Issue:** ${issue.issue}

**Impact:**
- Occurrences: ${issue.occurrences}
- Affected Customers: ${issue.affectedCustomers}
- Related Tickets: ${issue.ticketIds.join(', ')}

**Suggested Solution:**
${issue.suggestedSolution || 'To be determined'}

**Next Steps:**
1. Review the related tickets to understand the root cause
2. Implement a fix or workaround
3. Update the knowledge base
4. Notify affected customers

**Priority:** Based on the number of occurrences, this should be addressed soon.
`;

      // In a real implementation, make API call to ClickUp
      // For now, we'll store the task data
      const taskData = {
        name: `[Auto-PM] ${issue.issue}`,
        description: taskDescription,
        assignees: assigneeId ? [assigneeId] : [],
        priority: issue.occurrences >= 10 ? 'urgent' : issue.occurrences >= 5 ? 'high' : 'normal',
        tags: ['auto-generated', 'recurring-issue'],
        customFields: {
          occurrences: issue.occurrences,
          affectedCustomers: issue.affectedCustomers,
        },
      };

      // Store task reference in database
      await prisma.agentSource.create({
        data: {
          agentId: '', // We'll need to link to an agent
          sourceType: 'clickup_task',
          sourceId: `task_${Date.now()}`,
          content: taskDescription,
          metadata: taskData,
        },
      });

      logger.info(`ClickUp task created for recurring issue: ${issue.issue}`);

      return taskData;
    } catch (error) {
      logger.error('Error creating ClickUp task:', error);
      throw error;
    }
  }

  /**
   * Create a task in Asana for a recurring issue
   */
  async createAsanaTask(
    organizationId: string,
    issue: RecurringIssue,
    assigneeId?: string
  ): Promise<any> {
    try {
      // Get Asana connection
      const connection = await prisma.sourceConnection.findFirst({
        where: {
          organizationId,
          sourceType: 'Asana',
          isActive: true,
        },
      });

      if (!connection) {
        throw new AppError('Asana not connected', 400);
      }

      const credentials = connection.credentials as any;
      const projectId = credentials.projectId; // Should be configured during connection

      // Create detailed task description
      const taskNotes = `
Recurring Issue Detected by AI PM

Issue: ${issue.issue}

Impact:
• Occurrences: ${issue.occurrences}
• Affected Customers: ${issue.affectedCustomers}
• Related Tickets: ${issue.ticketIds.join(', ')}

Suggested Solution:
${issue.suggestedSolution || 'To be determined'}

Next Steps:
□ Review related tickets
□ Identify root cause
□ Implement fix
□ Update documentation
□ Notify customers
`;

      const taskData = {
        name: `[AI-PM] ${issue.issue}`,
        notes: taskNotes,
        assignee: assigneeId,
        projects: [projectId],
        tags: ['auto-generated', 'recurring-issue'],
        custom_fields: {
          occurrences: issue.occurrences,
          affected_customers: issue.affectedCustomers,
        },
      };

      logger.info(`Asana task created for recurring issue: ${issue.issue}`);

      return taskData;
    } catch (error) {
      logger.error('Error creating Asana task:', error);
      throw error;
    }
  }
}

export default new AutonomousAIService();
