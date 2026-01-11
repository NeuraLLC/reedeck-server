import { Response, NextFunction } from 'express';
import prisma from '../config/database';
import stripe from '../config/stripe';
import { supabaseAdmin } from '../config/supabase';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { sendWelcomeEmail } from '../services/emailService';

// Get all sales leads
export const getSalesLeads = async (
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

    const [salesLeads, total] = await Promise.all([
      prisma.salesLead.findMany({
        where,
        include: {
          selectedPlan: true,
          invoices: true,
        },
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
        skip: (Number(page) - 1) * Number(limit),
      }),
      prisma.salesLead.count({ where }),
    ]);

    res.json({
      salesLeads,
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

// Update sales lead
export const updateSalesLead = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, notes, selectedPlanId, seats, lostReason } = req.body;

    const data: any = {};

    if (status) {
      data.status = status;

      // Update timestamps based on status
      if (status === 'order_form_sent') data.orderFormSentAt = new Date();
      if (status === 'order_form_signed') data.orderFormSignedAt = new Date();
      if (status === 'invoice_sent') data.invoiceSentAt = new Date();
      if (status === 'payment_received') data.paymentReceivedAt = new Date();
    }

    if (notes !== undefined) data.notes = notes;
    if (selectedPlanId !== undefined) data.selectedPlanId = selectedPlanId;
    if (seats !== undefined) data.seats = seats;
    if (lostReason !== undefined) data.lostReason = lostReason;

    // Recalculate annual value if plan or seats changed
    if (selectedPlanId || seats) {
      const lead = await prisma.salesLead.findUnique({
        where: { id },
        include: { selectedPlan: true },
      });

      if (lead) {
        const planId = selectedPlanId || lead.selectedPlanId;
        const seatCount = seats || lead.seats;

        if (planId) {
          const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
          if (plan && plan.priceAnnual) {
            data.annualValue = Number(plan.priceAnnual) * seatCount;
          }
        }
      }
    }

    const salesLead = await prisma.salesLead.update({
      where: { id },
      data,
      include: {
        selectedPlan: true,
        invoices: true,
      },
    });

    res.json(salesLead);
  } catch (error) {
    next(error);
  }
};

// Generate invoice for sales lead
export const generateInvoice = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { amount, dueDate, notes, billingPeriod = 'annual' } = req.body; // monthly or annual

    const salesLead = await prisma.salesLead.findUnique({
      where: { id },
      include: { selectedPlan: true },
    });

    if (!salesLead) {
      throw new AppError('Sales lead not found', 404);
    }

    if (!salesLead.selectedPlan) {
      throw new AppError('Sales lead must have a selected plan', 400);
    }

    // Generate invoice number
    const invoiceCount = await prisma.invoice.count();
    const invoiceNumber = `INV-${String(invoiceCount + 1).padStart(5, '0')}`;

    // Calculate amount based on billing period (in cents)
    let invoiceAmount: number;
    let description: string;

    if (amount) {
      // Custom amount provided
      invoiceAmount = amount;
      description = `${salesLead.selectedPlan.name} Plan - ${billingPeriod === 'monthly' ? 'Monthly' : 'Annual'} Subscription (${salesLead.seats} ${salesLead.seats === 1 ? 'seat' : 'seats'})`;
    } else {
      // Calculate based on billing period
      if (billingPeriod === 'monthly') {
        const monthlyPrice = Number(salesLead.selectedPlan.priceMonthly) * 100; // Convert to cents
        invoiceAmount = monthlyPrice * salesLead.seats;
        description = `${salesLead.selectedPlan.name} Plan - Monthly Subscription (${salesLead.seats} ${salesLead.seats === 1 ? 'seat' : 'seats'})`;
      } else {
        // Annual billing
        const annualPrice = salesLead.selectedPlan.priceAnnual
          ? Number(salesLead.selectedPlan.priceAnnual) * 100
          : Number(salesLead.selectedPlan.priceMonthly) * 12 * 100; // Fallback to 12x monthly
        invoiceAmount = annualPrice * salesLead.seats;
        description = `${salesLead.selectedPlan.name} Plan - Annual Subscription (${salesLead.seats} ${salesLead.seats === 1 ? 'seat' : 'seats'})`;
      }
    }

    // Create Stripe invoice
    let stripeInvoice;
    try {
      // Create or get Stripe customer
      const customer = await stripe.customers.create({
        email: salesLead.email,
        name: `${salesLead.firstName} ${salesLead.lastName}`,
        metadata: {
          salesLeadId: salesLead.id,
          organizationName: salesLead.organizationName,
        },
      });

      // Create invoice item
      await stripe.invoiceItems.create({
        customer: customer.id,
        amount: invoiceAmount,
        currency: 'usd',
        description,
      });

      // Create invoice
      stripeInvoice = await stripe.invoices.create({
        customer: customer.id,
        auto_advance: false, // Don't auto-finalize
        collection_method: 'send_invoice',
        days_until_due: Math.ceil((new Date(dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
        metadata: {
          salesLeadId: salesLead.id,
          invoiceNumber,
        },
      });

      // Finalize invoice
      await stripe.invoices.finalizeInvoice(stripeInvoice.id);

      // Send invoice
      await stripe.invoices.sendInvoice(stripeInvoice.id);
    } catch (stripeError: any) {
      throw new AppError(`Stripe error: ${stripeError.message}`, 500);
    }

    // Create invoice record
    const invoice = await prisma.invoice.create({
      data: {
        salesLeadId: id,
        stripeInvoiceId: stripeInvoice.id,
        invoiceNumber,
        amount: invoiceAmount,
        status: 'sent',
        dueDate: new Date(dueDate),
        invoiceUrl: stripeInvoice.invoice_pdf || null,
        paymentUrl: stripeInvoice.hosted_invoice_url || null,
        notes,
      },
    });

    // Update sales lead status
    await prisma.salesLead.update({
      where: { id },
      data: {
        status: 'invoice_sent',
        invoiceSentAt: new Date(),
      },
    });

    res.json(invoice);
  } catch (error) {
    next(error);
  }
};

// Create customer account after payment
export const createCustomerAccount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    const salesLead = await prisma.salesLead.findUnique({
      where: { id },
      include: { selectedPlan: true },
    });

    if (!salesLead) {
      throw new AppError('Sales lead not found', 404);
    }

    if (salesLead.status !== 'payment_received') {
      throw new AppError('Payment must be received before creating account', 400);
    }

    if (salesLead.convertedOrgId) {
      throw new AppError('Account already created for this lead', 400);
    }

    // Create organization slug
    const slug = salesLead.organizationName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Check if slug is unique
    let finalSlug = slug;
    let counter = 1;
    while (await prisma.organization.findUnique({ where: { slug: finalSlug } })) {
      finalSlug = `${slug}-${counter}`;
      counter++;
    }

    // Create customer account with Supabase
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: salesLead.email,
      password: password,
      email_confirm: false, // User must confirm email
      user_metadata: {
        first_name: salesLead.firstName,
        last_name: salesLead.lastName,
      },
    });

    if (authError || !authData.user) {
      throw new AppError(authError?.message || 'Failed to create user in Supabase', 400);
    }

    // Create subscription, organization, and user record in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create subscription
      const subscription = await tx.subscription.create({
        data: {
          planId: salesLead.selectedPlanId!,
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
        },
      });

      // Create organization
      const organization = await tx.organization.create({
        data: {
          name: salesLead.organizationName,
          slug: finalSlug,
          subscriptionId: subscription.id,
        },
      });

      // Create user record (linked to Supabase auth)
      const user = await tx.user.create({
        data: {
          id: authData.user.id, // Use Supabase user ID
          email: salesLead.email,
          passwordHash: '', // Handled by Supabase
          firstName: salesLead.firstName,
          lastName: salesLead.lastName,
          emailVerified: false,
        },
      });

      // Create organization membership
      await tx.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: 'admin',
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

      return { user, organization, subscription };
    });

    // Update sales lead
    await prisma.salesLead.update({
      where: { id },
      data: {
        convertedOrgId: result.organization.id,
      },
    });

    // Send welcome email
    try {
      await sendWelcomeEmail({
        toEmail: salesLead.email,
        firstName: salesLead.firstName,
        organizationName: salesLead.organizationName,
      });
    } catch (emailErr) {
      // Don't fail the whole process if email fails
      console.error('Failed to send welcome email:', emailErr);
    }

    res.json({
      message: 'Customer account created successfully. A welcome email and verification link have been sent.',
      organization: result.organization,
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
      },
    });
  } catch (error) {
    next(error);
  }
};
