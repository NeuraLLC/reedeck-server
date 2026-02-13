import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import authService from '../services/authService';

export const acceptInvitationValidation = [
  body('token').notEmpty().trim(),
  body('fullName').notEmpty().trim(),
  body('password').isLength({ min: 8 }),
];

export const verifyInvitation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { token } = req.params;

    if (!token) {
      throw new AppError('Token is required', 400);
    }

    // Find the invitation
    const invitation = await prisma.teammateInvitation.findUnique({
      where: { token },
      include: {
        inviter: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!invitation) {
      throw new AppError('Invalid invitation token', 404);
    }

    // Check if already used
    if (invitation.status === 'accepted') {
      throw new AppError('Invitation already used', 400);
    }

    // Check if expired
    if (new Date() > invitation.expiresAt) {
      throw new AppError('Invitation has expired', 400);
    }

    // Get organization details
    const organization = await prisma.organization.findUnique({
      where: { id: invitation.organizationId },
      select: {
        id: true,
        name: true,
      },
    });

    if (!organization) {
      throw new AppError('Organization not found', 404);
    }

    res.json({
      valid: true,
      email: invitation.email,
      organizationName: organization.name,
      role: invitation.role,
      inviterName: `${invitation.inviter.firstName} ${invitation.inviter.lastName}`,
    });
  } catch (error) {
    next(error);
  }
};

export const acceptInvitation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400);
    }

    const { token, fullName, password } = req.body;

    // Find the invitation
    const invitation = await prisma.teammateInvitation.findUnique({
      where: { token },
    });

    if (!invitation) {
      throw new AppError('Invalid invitation token', 404);
    }

    // Check if already used
    if (invitation.status === 'accepted') {
      throw new AppError('Invitation already used', 400);
    }

    // Check if expired
    if (new Date() > invitation.expiresAt) {
      throw new AppError('Invitation has expired', 400);
    }

    // Check if user already exists with this email
    const existingUser = await prisma.user.findUnique({
      where: { email: invitation.email },
    });

    let userId: string;
    let authResult: any;

    if (existingUser) {
      // User exists, just add them to the organization
      userId = existingUser.id;

      // Sign in the existing user
      authResult = await authService.login({
        email: invitation.email,
        password,
      });
    } else {
      // Create new user account
      const [firstName, ...lastNameParts] = fullName.split(' ');
      const lastName = lastNameParts.join(' ');

      // Create user via Supabase Auth
      const signupResult = await authService.signupFromInvitation({
        email: invitation.email,
        password,
        firstName: firstName || fullName,
        lastName: lastName || '',
      });

      userId = signupResult.user.id;
      authResult = signupResult;
    }

    // Add user to organization
    await prisma.organizationMember.create({
      data: {
        userId,
        organizationId: invitation.organizationId,
        role: invitation.role,
        status: 'active',
      },
    });

    // Mark invitation as accepted
    await prisma.teammateInvitation.update({
      where: { id: invitation.id },
      data: { status: 'accepted' },
    });

    res.status(200).json(authResult);
  } catch (error) {
    next(error);
  }
};
