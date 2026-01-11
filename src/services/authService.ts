import { supabaseAdmin } from '../config/supabase';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import logger from '../config/logger';

interface SignupData {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  organizationName: string;
  teamSize?: string;
}

interface LoginData {
  email: string;
  password: string;
}

interface SignupFromInvitationData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export class AuthService {
  async signup(data: SignupData) {
    try {
      // Create organization slug from name
      const slug = data.organizationName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      // Check if slug is unique
      const existingOrg = await prisma.organization.findUnique({
        where: { slug },
      });

      if (existingOrg) {
        throw new AppError('Organization with this name already exists', 400);
      }

      // Create user with Supabase Auth
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password: data.password,
        email_confirm: false, // Set to true if you want to skip email verification
        user_metadata: {
          first_name: data.firstName,
          last_name: data.lastName,
        },
      });

      if (authError || !authData.user) {
        logger.error('Supabase signup error:', authError);
        throw new AppError(authError?.message || 'Failed to create user', 400);
      }

      // Get starter plan
      const starterPlan = await prisma.subscriptionPlan.findUnique({
        where: { name: 'Starter' },
      });

      if (!starterPlan) {
        throw new AppError('Starter plan not found', 500);
      }

      // Create subscription, organization, and user record in a transaction
      const result = await prisma.$transaction(async (tx) => {
        // Create subscription
        const subscription = await tx.subscription.create({
          data: {
            planId: starterPlan.id,
            status: 'trial', // Start with trial
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days trial
          },
        });

        // Create organization
        const organization = await tx.organization.create({
          data: {
            name: data.organizationName,
            slug,
            teamSize: data.teamSize,
            subscriptionId: subscription.id,
          },
        });

        // Create user record (linked to Supabase auth)
        const user = await tx.user.create({
          data: {
            id: authData.user.id, // Use Supabase user ID
            email: data.email,
            // passwordHash is null - managed by Supabase Auth
            firstName: data.firstName,
            lastName: data.lastName,
            emailVerified: false,
          },
        });

        // Create organization membership with admin role
        await tx.organizationMember.create({
          data: {
            organizationId: organization.id,
            userId: user.id,
            role: 'admin', // First user is always admin
            status: 'active',
          },
        });

        // Initialize usage tracking
        const currentPeriod = new Date().toISOString().slice(0, 7);
        await tx.usageTracking.create({
          data: {
            subscriptionId: subscription.id,
            period: currentPeriod,
          },
        });

        return { user, organization };
      });

      // Generate session with Supabase
      const { data: sessionData, error: sessionError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email: data.email,
      });

      if (sessionError) {
        logger.error('Session generation error:', sessionError);
      }

      // Sign in to get tokens
      const { data: signInData, error: signInError } = await supabaseAdmin.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (signInError || !signInData.session) {
        logger.error('Sign in error:', signInError);
        throw new AppError('Failed to create session', 500);
      }

      return {
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
        user: {
          id: result.user.id,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
        },
        organization: {
          id: result.organization.id,
          name: result.organization.name,
          slug: result.organization.slug,
        },
      };
    } catch (error) {
      logger.error('Signup error:', error);
      throw error;
    }
  }

  async login(data: LoginData) {
    try {
      // Sign in with Supabase
      const { data: signInData, error: signInError } = await supabaseAdmin.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (signInError || !signInData.session) {
        logger.error('Supabase login error:', signInError);
        throw new AppError('Invalid email or password', 401);
      }

      // Get user details from database
      const user = await prisma.user.findUnique({
        where: { id: signInData.user.id },
        include: {
          organizationMembers: {
            where: { status: 'active' },
            include: {
              organization: true,
            },
          },
        },
      });

      if (!user) {
        throw new AppError('User not found', 404);
      }

      return {
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        organizations: user.organizationMembers.map((om) => ({
          id: om.organization.id,
          name: om.organization.name,
          slug: om.organization.slug,
          role: om.role,
        })),
      };
    } catch (error) {
      logger.error('Login error:', error);
      throw error;
    }
  }

  async signupFromInvitation(data: SignupFromInvitationData) {
    try {
      // Create user with Supabase Auth
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password: data.password,
        email_confirm: false,
        user_metadata: {
          first_name: data.firstName,
          last_name: data.lastName,
        },
      });

      if (authError || !authData.user) {
        logger.error('Supabase signup error:', authError);
        throw new AppError(authError?.message || 'Failed to create user', 400);
      }

      // Create user record in database
      const user = await prisma.user.create({
        data: {
          id: authData.user.id,
          email: data.email,
          // passwordHash is null - managed by Supabase Auth
          firstName: data.firstName,
          lastName: data.lastName,
          emailVerified: false,
        },
      });

      // Sign in to get tokens
      const { data: signInData, error: signInError } = await supabaseAdmin.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (signInError || !signInData.session) {
        logger.error('Sign in error:', signInError);
        throw new AppError('Failed to create session', 500);
      }

      return {
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
      };
    } catch (error) {
      logger.error('Signup from invitation error:', error);
      throw error;
    }
  }

  async verifyToken(token: string) {
    try {
      // Verify token with Supabase
      const { data, error } = await supabaseAdmin.auth.getUser(token);

      if (error || !data.user) {
        logger.error('Token verification error:', error);
        throw new AppError('Invalid token', 401);
      }

      // Get user details from database
      const user = await prisma.user.findUnique({
        where: { id: data.user.id },
        include: {
          organizationMembers: {
            where: { status: 'active' },
            include: {
              organization: true,
            },
          },
        },
      });

      if (!user) {
        throw new AppError('User not found', 404);
      }

      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        organizations: user.organizationMembers.map((om) => ({
          id: om.organization.id,
          name: om.organization.name,
          slug: om.organization.slug,
          role: om.role,
        })),
      };
    } catch (error) {
      logger.error('Token verification error:', error);
      throw new AppError('Invalid token', 401);
    }
  }

  async forgotPassword(email: string) {
    try {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
        redirectTo: `${frontendUrl}/auth/callback?type=recovery`,
      });

      if (error) {
        logger.error('Forgot password error:', error);
        throw new AppError(error.message, 400);
      }

      return { message: 'Password reset link sent to your email' };
    } catch (error) {
      logger.error('Forgot password error:', error);
      throw error;
    }
  }

  async resetPassword(password: string, accessToken: string) {
    try {
      // Use the provided access token to update the user's password
      const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
        (await supabaseAdmin.auth.getUser(accessToken)).data.user?.id!,
        { password }
      );

      if (error) {
        logger.error('Reset password error:', error);
        throw new AppError(error.message, 400);
      }

      return { message: 'Password has been reset successfully' };
    } catch (error) {
      logger.error('Reset password error:', error);
      throw error;
    }
  }
}

export default new AuthService();
