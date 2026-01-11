import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import logger from '../config/logger';

export const demoRequestValidation = [
  body('email').isEmail().normalizeEmail(),
  body('firstName').notEmpty().trim(),
  body('lastName').notEmpty().trim(),
  body('organizationName').notEmpty().trim(),
  body('teamSize').optional().trim(),
  body('useCase').optional().trim(),
];

export const submitDemoRequest = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400);
    }

    const { email, firstName, lastName, organizationName, teamSize, useCase } = req.body;

    // Check if demo request already exists for this email
    const existingRequest = await prisma.demoRequest.findFirst({
      where: { email },
    });

    if (existingRequest) {
      // Update existing request instead of creating duplicate
      const updatedRequest = await prisma.demoRequest.update({
        where: { id: existingRequest.id },
        data: {
          firstName,
          lastName,
          organizationName,
          teamSize,
          useCase,
          status: 'submitted', // Reset status
        },
      });

      logger.info(`Demo request updated for ${email}`);
      res.status(200).json({
        message: 'Demo request updated successfully',
        requestId: updatedRequest.id,
      });
      return;
    }

    // Create new demo request
    const demoRequest = await prisma.demoRequest.create({
      data: {
        email,
        firstName,
        lastName,
        organizationName,
        teamSize,
        useCase,
        status: 'submitted',
      },
    });

    logger.info(`New demo request created: ${email}`);

    // TODO: Send notification to sales team (Slack/Email)
    // TODO: Send confirmation email to user

    res.status(201).json({
      message: 'Demo request submitted successfully',
      requestId: demoRequest.id,
    });
  } catch (error) {
    next(error);
  }
};

export const bookDemo = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { requestId } = req.params;
    const payload = req.body;

    // Cal.com webhook payload structure
    const {
      startTime,
      endTime,
      metadata,
      attendees,
    } = payload;

    // Extract demo request ID from metadata or use route param
    const demoId = requestId || metadata?.demoRequestId;

    if (!demoId) {
      throw new AppError('Demo request ID not found', 400);
    }

    // Update demo request with booking details
    const demoRequest = await prisma.demoRequest.update({
      where: { id: demoId },
      data: {
        status: 'demo_booked',
        demoBookedAt: startTime ? new Date(startTime) : new Date(),
        notes: `Booked via Cal.com - Start: ${startTime}, End: ${endTime}, Attendees: ${attendees?.map((a: any) => a.email).join(', ')}`,
      },
    });

    logger.info(`Demo booked for request ${demoId} at ${startTime}`);

    // TODO: Send confirmation email to user
    // TODO: Notify sales team via Slack/Email

    res.json({
      message: 'Demo booked successfully',
      demoRequest,
    });
  } catch (error) {
    next(error);
  }
};
