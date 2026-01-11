import { Router } from 'express';
import { adminAuthenticate } from '../middleware/adminAuth';
import { adminLogin, resendConfirmationEmail } from '../controllers/adminAuthController';
import { getAdminStats } from '../controllers/adminStatsController';
import {
  getDemoRequests,
  updateDemoRequest,
  convertToLead,
} from '../controllers/adminDemoController';
import {
  getSalesLeads,
  updateSalesLead,
  generateInvoice,
  createCustomerAccount,
} from '../controllers/adminSalesController';

const router = Router();

// Auth routes (no middleware)
router.post('/auth/login', adminLogin);
router.post('/auth/resend-confirmation', resendConfirmationEmail);

// Protected routes (require super admin)
router.use(adminAuthenticate);

// Stats
router.get('/stats', getAdminStats);

// Demo Requests
router.get('/demo-requests', getDemoRequests);
router.patch('/demo-requests/:id', updateDemoRequest);
router.post('/demo-requests/:id/convert', convertToLead);

// Sales Leads
router.get('/sales-leads', getSalesLeads);
router.patch('/sales-leads/:id', updateSalesLead);
router.post('/sales-leads/:id/invoice', generateInvoice);
router.post('/sales-leads/:id/create-account', createCustomerAccount);

export default router;
