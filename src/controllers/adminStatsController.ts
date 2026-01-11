import { Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';

export const getAdminStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get demo requests stats
    const [totalDemoRequests, thisMonthDemoRequests, pendingDemoRequests] = await Promise.all([
      prisma.demoRequest.count(),
      prisma.demoRequest.count({
        where: {
          createdAt: {
            gte: firstDayOfMonth,
          },
        },
      }),
      prisma.demoRequest.count({
        where: {
          status: 'submitted',
        },
      }),
    ]);

    // Get sales leads stats
    const [totalSalesLeads, qualifiedLeads, convertedLeads] = await Promise.all([
      prisma.salesLead.count(),
      prisma.salesLead.count({
        where: {
          status: {
            in: ['qualified', 'order_form_sent', 'order_form_signed', 'invoice_sent'],
          },
        },
      }),
      prisma.salesLead.count({
        where: {
          status: 'payment_received',
        },
      }),
    ]);

    // Get revenue stats (in cents)
    const activeSubscriptions = await prisma.subscription.findMany({
      where: {
        status: 'active',
      },
      include: {
        plan: true,
      },
    });

    const mrr = activeSubscriptions.reduce((sum, sub) => {
      return sum + Number(sub.plan.priceMonthly) * 100; // Convert to cents
    }, 0);

    const arr = mrr * 12;

    // Get this month's revenue from new subscriptions
    const thisMonthRevenue = await prisma.subscription.count({
      where: {
        status: 'active',
        createdAt: {
          gte: firstDayOfMonth,
        },
      },
    });

    // Calculate conversion rates
    const completedDemos = await prisma.demoRequest.count({
      where: {
        status: {
          in: ['demo_completed', 'qualified'],
        },
      },
    });

    const demoToLeadRate = completedDemos > 0
      ? Math.round((totalSalesLeads / completedDemos) * 100)
      : 0;

    const leadToPaidRate = totalSalesLeads > 0
      ? Math.round((convertedLeads / totalSalesLeads) * 100)
      : 0;

    res.json({
      demoRequests: {
        total: totalDemoRequests,
        thisMonth: thisMonthDemoRequests,
        pending: pendingDemoRequests,
      },
      salesLeads: {
        total: totalSalesLeads,
        qualified: qualifiedLeads,
        converted: convertedLeads,
      },
      revenue: {
        mrr,
        arr,
        thisMonth: thisMonthRevenue * (mrr / (activeSubscriptions.length || 1)),
      },
      conversions: {
        demoToLead: demoToLeadRate,
        leadToPaid: leadToPaidRate,
      },
    });
  } catch (error) {
    next(error);
  }
};
