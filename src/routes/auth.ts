import { Router } from 'express';
import { signup, login, verifyToken, signupValidation, loginValidation, forgotPassword, resetPassword, refreshToken } from '../controllers/authController';
import { authLimiter } from '../middleware/security';

const router = Router();

// Apply strict rate limiting to auth endpoints
router.post('/signup', authLimiter, signupValidation, signup);
router.post('/login', authLimiter, loginValidation, login);
router.post('/refresh', refreshToken);
router.get('/verify', verifyToken);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);

export default router;
