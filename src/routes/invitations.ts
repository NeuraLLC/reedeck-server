import { Router } from 'express';
import {
  verifyInvitation,
  acceptInvitation,
  acceptInvitationValidation,
} from '../controllers/invitationController';

const router = Router();

// Public routes (no authentication required)
router.get('/verify/:token', verifyInvitation);
router.post('/accept', acceptInvitationValidation, acceptInvitation);

export default router;
