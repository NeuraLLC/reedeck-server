import { Router } from 'express';
import { Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { attachOrganization, requireAdmin } from '../middleware/organization';
import { checkSubscriptionLimits } from '../middleware/rateLimit';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';

const router = Router();

router.use(authenticate);
router.use(attachOrganization);

// Get all forms
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const forms = await prisma.form.findMany({
      where: {
        organizationId: req.organizationId,
      },
      include: {
        _count: {
          select: { submissions: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(forms);
  } catch (error) {
    next(error);
  }
});

// Get single form
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const form = await prisma.form.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId,
      },
      include: {
        _count: {
          select: { submissions: true },
        },
      },
    });

    if (!form) {
      throw new AppError('Form not found', 404);
    }

    res.json(form);
  } catch (error) {
    next(error);
  }
});

// Create form
router.post(
  '/',
  requireAdmin,
  checkSubscriptionLimits('forms'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { name, description, fields, settings } = req.body;

      const form = await prisma.form.create({
        data: {
          organizationId: req.organizationId!,
          name,
          description,
          fields,
          settings: settings || {},
        },
      });

      res.status(201).json(form);
    } catch (error) {
      next(error);
    }
  }
);

// Update form
router.patch(
  '/:id',
  requireAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { name, description, fields, settings, isActive } = req.body;

      const form = await prisma.form.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.organizationId,
        },
      });

      if (!form) {
        throw new AppError('Form not found', 404);
      }

      const updated = await prisma.form.update({
        where: { id: req.params.id },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
          ...(fields && { fields }),
          ...(settings && { settings }),
          ...(isActive !== undefined && { isActive }),
        },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// Get form submissions
router.get('/:id/submissions', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page = 1, limit = 50 } = req.query;

    const form = await prisma.form.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId,
      },
    });

    if (!form) {
      throw new AppError('Form not found', 404);
    }

    const submissions = await prisma.formSubmission.findMany({
      where: { formId: req.params.id },
      orderBy: { createdAt: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });

    const total = await prisma.formSubmission.count({
      where: { formId: req.params.id },
    });

    res.json({
      submissions,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Delete form
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const form = await prisma.form.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId,
      },
    });

    if (!form) {
      throw new AppError('Form not found', 404);
    }

    // Delete all submissions first (cascade delete)
    await prisma.formSubmission.deleteMany({
      where: { formId: req.params.id },
    });

    // Delete the form
    await prisma.form.delete({
      where: { id: req.params.id },
    });

    res.json({ success: true, message: 'Form deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// Get embed code
router.get('/:id/embed-code', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const form = await prisma.form.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId,
      },
    });

    if (!form) {
      throw new AppError('Form not found', 404);
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const embedCode = `<iframe src="${frontendUrl}/forms/${form.id}/embed" width="100%" height="600" frameborder="0"></iframe>`;
    const scriptCode = `<script src="${frontendUrl}/embed.js" data-form-id="${form.id}"></script>`;

    res.json({
      iframe: embedCode,
      script: scriptCode,
      directUrl: `${frontendUrl}/forms/${form.id}`,
    });
  } catch (error) {
    next(error);
  }
});

// Get form analytics
router.get('/:id/analytics', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const form = await prisma.form.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId,
      },
      include: {
        _count: {
          select: { submissions: true },
        },
      },
    });

    if (!form) {
      throw new AppError('Form not found', 404);
    }

    // Calculate analytics
    const totalSubmissions = form._count.submissions;
    const views = (form.settings as any)?.views || 0;
    const conversionRate = views > 0 ? ((totalSubmissions / views) * 100).toFixed(2) : 0;

    // Get submissions over time (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const submissionsOverTime = await prisma.formSubmission.groupBy({
      by: ['createdAt'],
      where: {
        formId: req.params.id,
        createdAt: {
          gte: thirtyDaysAgo,
        },
      },
      _count: true,
    });

    res.json({
      totalSubmissions,
      views,
      conversionRate: Number(conversionRate),
      submissionsOverTime,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
