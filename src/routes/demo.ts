import { Router } from 'express';
import {
  submitDemoRequest,
  bookDemo,
  demoRequestValidation,
} from '../controllers/demoController';
import { authLimiter } from '../middleware/security';

const router = Router();

// Public endpoint - anyone can submit a demo request
router.post('/request', authLimiter, demoRequestValidation, submitDemoRequest);

// Webhook endpoint for calendar booking (Cal.com webhook)
// Support both with and without requestId in URL
router.post('/book/:requestId?', bookDemo);

export default router;
