import { Router } from 'express';
import { Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { attachOrganization, requireAdmin } from '../middleware/organization';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { emailQueue } from '../config/queue';

const router = Router();

router.use(authenticate);

// Get all organizations for current user
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const memberships = await prisma.organizationMember.findMany({
      where: {
        userId: req.userId,
        status: 'active',
      },
      include: {
        organization: {
          include: {
            subscription: {
              include: {
                plan: true,
              },
            },
          },
        },
      },
    });

    const organizations = memberships.map((m) => ({
      ...m.organization,
      role: m.role,
      joinedAt: m.joinedAt,
    }));

    res.json(organizations);
  } catch (error) {
    next(error);
  }
});

router.use(attachOrganization);

// Get current organization details
router.get('/current', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.organizationId },
      include: {
        subscription: {
          include: {
            plan: true,
            usageTracking: {
              where: {
                period: new Date().toISOString().slice(0, 7),
              },
            },
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    if (!organization) {
      throw new AppError('Organization not found', 404);
    }

    res.json(organization);
  } catch (error) {
    next(error);
  }
});

// Update organization
router.patch('/current', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, avatarUrl, teamSize } = req.body;

    const updated = await prisma.organization.update({
      where: { id: req.organizationId },
      data: {
        ...(name && { name }),
        ...(avatarUrl !== undefined && { avatarUrl }),
        ...(teamSize && { teamSize }),
      },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// Get organization members
router.get('/members', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const members = await prisma.organizationMember.findMany({
      where: {
        organizationId: req.organizationId,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });

    res.json(members);
  } catch (error) {
    next(error);
  }
});

// Invite teammate
router.post('/members/invite', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { email, role } = req.body;

    // Generate invite token
    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);

    const invitation = await prisma.teammateInvitation.create({
      data: {
        email,
        organizationId: req.organizationId!,
        invitedBy: req.userId!,
        role: role || 'member',
        token,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
      include: {
        inviter: true,
      },
    });

    // Fetch organization details for email
    const organization = await prisma.organization.findUnique({
      where: { id: req.organizationId! },
    });

    if (!organization) {
      throw new AppError('Organization not found', 404);
    }

    // Queue invitation email (background job)
    await emailQueue.add({
      type: 'invitation',
      data: {
        toEmail: email,
        organizationName: organization.name,
        inviterName: `${invitation.inviter.firstName} ${invitation.inviter.lastName}`,
        role: invitation.role,
        token: invitation.token,
      },
    });

    res.status(201).json(invitation);
  } catch (error) {
    next(error);
  }
});

// Update member role
router.patch('/members/:memberId', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { role, status } = req.body;

    const member = await prisma.organizationMember.findFirst({
      where: {
        id: req.params.memberId,
        organizationId: req.organizationId,
      },
    });

    if (!member) {
      throw new AppError('Member not found', 404);
    }

    const updated = await prisma.organizationMember.update({
      where: { id: req.params.memberId },
      data: {
        ...(role && { role }),
        ...(status && { status }),
      },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// Delete member
router.delete('/members/:memberId', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const member = await prisma.organizationMember.findFirst({
      where: {
        id: req.params.memberId,
        organizationId: req.organizationId,
      },
    });

    if (!member) {
      throw new AppError('Member not found', 404);
    }

    // Don't allow deleting yourself
    if (member.userId === req.userId) {
      throw new AppError('Cannot remove yourself from the organization', 400);
    }

    await prisma.organizationMember.delete({
      where: { id: req.params.memberId },
    });

    res.json({ success: true, message: 'Member removed successfully' });
  } catch (error) {
    next(error);
  }
});

// Resend invitation
router.post('/members/:invitationId/resend-invite', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const invitation = await prisma.teammateInvitation.findFirst({
      where: {
        id: req.params.invitationId,
        organizationId: req.organizationId,
      },
      include: {
        inviter: true,
      },
    });

    if (!invitation) {
      throw new AppError('Invitation not found', 404);
    }

    // Check if invitation is still pending
    if (invitation.status !== 'pending') {
      throw new AppError('Can only resend pending invitations', 400);
    }

    // Get organization details
    const organization = await prisma.organization.findUnique({
      where: { id: req.organizationId! },
    });

    if (!organization) {
      throw new AppError('Organization not found', 404);
    }

    // Queue invitation email (background job)
    await emailQueue.add({
      type: 'invitation',
      data: {
        toEmail: invitation.email,
        organizationName: organization.name,
        inviterName: `${invitation.inviter.firstName} ${invitation.inviter.lastName}`,
        role: invitation.role,
        token: invitation.token,
      },
    });

    res.json({ success: true, message: 'Invitation resent successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
