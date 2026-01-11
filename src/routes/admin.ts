import { Router } from 'express';
import { Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { attachOrganization, requireAdmin } from '../middleware/organization';
import { AuthRequest } from '../types';
import { getBlacklistStats, removeFromBlacklist } from '../middleware/ipBlacklist';

const router = Router();

router.use(authenticate);
router.use(attachOrganization);
router.use(requireAdmin);

// Get security statistics
router.get('/security/stats', (req: AuthRequest, res: Response) => {
  const stats = getBlacklistStats();
  res.json(stats);
});

// Remove IP from blacklist
router.post('/security/unblock-ip', (req: AuthRequest, res: Response) => {
  const { ip } = req.body;

  if (!ip) {
    res.status(400).json({ error: 'IP address is required' });
    return;
  }

  removeFromBlacklist(ip);
  res.json({ message: `IP ${ip} removed from blacklist` });
});

export default router;
