import { Router } from 'express';
import { Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { attachOrganization, requireAdmin } from '../middleware/organization';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import stripe from '../config/stripe';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// Get all subscription plans (public)
router.get('/plans', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { priceMonthly: 'asc' },
    });

    res.json(plans);
  } catch (error) {
    next(error);
  }
});

router.use(authenticate);
router.use(attachOrganization);

// Get current subscription
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
      },
    });

    if (!organization || !organization.subscription) {
      throw new AppError('No subscription found', 404);
    }

    res.json(organization.subscription);
  } catch (error) {
    next(error);
  }
});

// Create Stripe checkout session
router.post('/checkout', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { planId } = req.body;

    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      throw new AppError('Plan not found', 404);
    }

    const organization = await prisma.organization.findUnique({
      where: { id: req.organizationId },
      include: { subscription: true },
    });

    if (!organization) {
      throw new AppError('Organization not found', 404);
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Reedeck ${plan.name} Plan`,
              description: `${plan.aiAgentsLimit} AI agents, ${plan.teammatesLimit} teammates`,
            },
            unit_amount: Math.round(Number(plan.priceMonthly) * 100),
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/settings?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/settings`,
      client_reference_id: req.organizationId,
      metadata: {
        organizationId: req.organizationId!,
        planId: plan.id,
      },
    });

    res.json({ url: session.url });
  } catch (error) {
    next(error);
  }
});

// Stripe webhook handler
router.post('/webhook', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sig = req.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: any) {
      throw new AppError(`Webhook Error: ${err.message}`, 400);
    }

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object as any;
        const organizationId = session.metadata.organizationId;
        const planId = session.metadata.planId;

        // Update subscription
        const organization = await prisma.organization.findUnique({
          where: { id: organizationId },
          include: { subscription: true },
        });

        if (organization?.subscription) {
          await prisma.subscription.update({
            where: { id: organization.subscription.id },
            data: {
              planId,
              stripeCustomerId: session.customer,
              stripeSubscriptionId: session.subscription,
              status: 'active',
              currentPeriodStart: new Date(),
              currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
          });
        }
        break;

      case 'customer.subscription.deleted':
        const subscription = event.data.object as any;
        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: { status: 'canceled' },
        });
        break;

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    next(error);
  }
});

export default router;
