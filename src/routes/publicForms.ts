import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// Public form submission (no authentication required)
router.post('/:formId/submit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { formId } = req.params;
    const submissionData = req.body;

    // Find the form
    const form = await prisma.form.findUnique({
      where: { id: formId },
    });

    if (!form) {
      throw new AppError('Form not found', 404);
    }

    // Check if form is active
    if (!form.isActive) {
      throw new AppError('Form is not accepting submissions', 400);
    }

    // Validate submission against form fields
    const formFields = form.fields as any[];
    const errors: any = {};

    formFields.forEach((field: any) => {
      if (field.required && !submissionData[field.id]) {
        errors[field.id] = `${field.label} is required`;
      }

      // Additional validation based on field type
      if (submissionData[field.id]) {
        switch (field.type) {
          case 'email':
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(submissionData[field.id])) {
              errors[field.id] = 'Invalid email format';
            }
            break;
          case 'phone':
            const phoneRegex = /^\+?[\d\s-()]+$/;
            if (!phoneRegex.test(submissionData[field.id])) {
              errors[field.id] = 'Invalid phone format';
            }
            break;
          case 'number':
            if (isNaN(submissionData[field.id])) {
              errors[field.id] = 'Must be a number';
            }
            break;
        }

        // Custom validation if specified
        if (field.validation) {
          if (field.validation.minLength && submissionData[field.id].length < field.validation.minLength) {
            errors[field.id] = `Minimum length is ${field.validation.minLength}`;
          }
          if (field.validation.maxLength && submissionData[field.id].length > field.validation.maxLength) {
            errors[field.id] = `Maximum length is ${field.validation.maxLength}`;
          }
          if (field.validation.pattern) {
            const regex = new RegExp(field.validation.pattern);
            if (!regex.test(submissionData[field.id])) {
              errors[field.id] = field.validation.message || 'Invalid format';
            }
          }
        }
      }
    });

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ errors });
    }

    // Create submission
    const submission = await prisma.formSubmission.create({
      data: {
        formId,
        data: submissionData,
        ipAddress: req.ip || (req.headers['x-forwarded-for'] as string) || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      },
    });

    // Increment form submission counter (stored in settings)
    const currentSettings = form.settings as any || {};
    await prisma.form.update({
      where: { id: formId },
      data: {
        settings: {
          ...currentSettings,
          submissionCount: (currentSettings.submissionCount || 0) + 1,
        },
      },
    });

    // Create a ticket from the form submission
    try {
      // Extract common fields from submission
      let customerName = 'Anonymous';
      let customerEmail = 'unknown@form.submission';
      let subject = `Form Submission: ${form.name}`;
      let messageContent = '';

      // Build message content and extract customer info
      formFields.forEach((field: any) => {
        const value = submissionData[field.id];
        if (value !== undefined && value !== '') {
          // Try to identify name and email fields
          const labelLower = field.label.toLowerCase();
          if (field.type === 'email' || labelLower.includes('email')) {
            customerEmail = value;
          } else if (labelLower.includes('name') && !labelLower.includes('company')) {
            customerName = value;
          } else if (labelLower.includes('subject')) {
            subject = value;
          }

          // Add to message content
          messageContent += `**${field.label}:** ${value}\n`;
        }
      });

      // Create the ticket
      await prisma.ticket.create({
        data: {
          organizationId: form.organizationId,
          customerName,
          customerEmail,
          subject,
          status: 'open',
          priority: 'medium',
          metadata: {
            source: 'form',
            formId: form.id,
            formName: form.name,
            submissionId: submission.id,
          },
          messages: {
            create: {
              senderType: 'customer',
              content: messageContent || 'Form submission with no content',
            },
          },
        },
      });
    } catch (ticketError) {
      // Log error but don't fail the submission
      console.error('Failed to create ticket from form submission:', ticketError);
    }

    res.status(201).json({
      success: true,
      message: 'Form submitted successfully',
      submissionId: submission.id,
    });
  } catch (error) {
    next(error);
  }
});

// Get public form (for rendering the form)
router.get('/:formId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { formId } = req.params;

    const form = await prisma.form.findUnique({
      where: { id: formId },
      select: {
        id: true,
        name: true,
        description: true,
        fields: true,
        settings: true,
        isActive: true,
      },
    });

    if (!form) {
      throw new AppError('Form not found', 404);
    }

    if (!form.isActive) {
      throw new AppError('Form is not available', 400);
    }

    // Increment view counter
    const currentSettings = form.settings as any || {};
    await prisma.form.update({
      where: { id: formId },
      data: {
        settings: {
          ...currentSettings,
          views: (currentSettings.views || 0) + 1,
        },
      },
    });

    res.json(form);
  } catch (error) {
    next(error);
  }
});

export default router;
