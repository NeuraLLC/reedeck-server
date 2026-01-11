import { Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';

// Get all demo requests
export const getDemoRequests = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;

    const where: any = {};

    if (status && status !== 'all') {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { email: { contains: search as string, mode: 'insensitive' } },
        { firstName: { contains: search as string, mode: 'insensitive' } },
        { lastName: { contains: search as string, mode: 'insensitive' } },
        { organizationName: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const [demoRequests, total] = await Promise.all([
      prisma.demoRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
        skip: (Number(page) - 1) * Number(limit),
      }),
      prisma.demoRequest.count({ where }),
    ]);

    res.json({
      demoRequests,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Update demo request status
export const updateDemoRequest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, notes, demoBookedAt, demoCompletedAt } = req.body;

    const data: any = {};

    if (status) data.status = status;
    if (notes !== undefined) data.notes = notes;
    if (demoBookedAt !== undefined) data.demoBookedAt = demoBookedAt ? new Date(demoBookedAt) : null;
    if (demoCompletedAt !== undefined) data.demoCompletedAt = demoCompletedAt ? new Date(demoCompletedAt) : null;

    const demoRequest = await prisma.demoRequest.update({
      where: { id },
      data,
    });

    res.json(demoRequest);
  } catch (error) {
    next(error);
  }
};

// Convert demo request to sales lead
export const convertToLead = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { planId, seats, notes } = req.body;

    // Check if demo request exists
    const demoRequest = await prisma.demoRequest.findUnique({
      where: { id },
    });

    if (!demoRequest) {
      throw new AppError('Demo request not found', 404);
    }

    // Check if already converted
    const existingLead = await prisma.salesLead.findUnique({
      where: { demoRequestId: id },
    });

    if (existingLead) {
      throw new AppError('Demo request already converted to lead', 400);
    }

    // Get plan for annual value calculation
    const plan = planId ? await prisma.subscriptionPlan.findUnique({ where: { id: planId } }) : null;
    const annualValue = plan && plan.priceAnnual
      ? Number(plan.priceAnnual) * (seats || 1)
      : null;

    // Create sales lead
    const salesLead = await prisma.salesLead.create({
      data: {
        demoRequestId: id,
        firstName: demoRequest.firstName,
        lastName: demoRequest.lastName,
        email: demoRequest.email,
        organizationName: demoRequest.organizationName,
        selectedPlanId: planId || null,
        seats: seats || 1,
        annualValue,
        status: 'qualified',
        notes,
      },
      include: {
        selectedPlan: true,
      },
    });

    // Update demo request status
    await prisma.demoRequest.update({
      where: { id },
      data: { status: 'qualified' },
    });

    res.json(salesLead);
  } catch (error) {
    next(error);
  }
};
