import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';

// Track request counts per IP for burst detection
const requestCounts = new Map<string, { count: number; firstRequest: number }>();

// Rate limiter for authentication endpoints (stricter)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
    error: 'Too many authentication attempts, please try again after 15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logger.warn(`Rate limit exceeded for auth endpoint: ${req.ip}`);
    res.status(429).json({
      error: 'Too many authentication attempts, please try again after 15 minutes',
    });
  },
});

// Rate limiter for general API endpoints
export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 100 requests per minute
  message: {
    error: 'Too many requests, please try again later',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logger.warn(`API rate limit exceeded: ${req.ip} - ${req.path}`);
    res.status(429).json({
      error: 'Too many requests, please try again later',
    });
  },
});

// Strict rate limiter for AI chat endpoints (expensive operations)
export const aiChatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 AI requests per minute
  message: {
    error: 'Too many AI requests, please slow down',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logger.warn(`AI chat rate limit exceeded: ${req.ip}`);
    res.status(429).json({
      error: 'Too many AI requests, please slow down',
    });
  },
});

// Speed limiter - gradually slows down responses as user makes more requests
export const speedLimiter = slowDown({
  windowMs: 1 * 60 * 1000, // 1 minute
  delayAfter: 50, // Allow 50 requests per minute at full speed
  delayMs: (hits) => hits * 100, // Add 100ms delay per request after delayAfter
  maxDelayMs: 2000, // Maximum delay of 2 seconds
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
});

// Burst detection middleware
export const burstDetection = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const burstWindow = 10 * 1000; // 10 seconds
  const burstThreshold = 50; // 50 requests in 10 seconds is suspicious

  const record = requestCounts.get(ip);

  if (!record) {
    // First request from this IP
    requestCounts.set(ip, { count: 1, firstRequest: now });
    next();
    return;
  }

  const timeSinceFirst = now - record.firstRequest;

  if (timeSinceFirst > burstWindow) {
    // Reset the window
    requestCounts.set(ip, { count: 1, firstRequest: now });
    next();
    return;
  }

  // Increment count within the window
  record.count += 1;

  if (record.count > burstThreshold) {
    logger.error(`Burst attack detected from IP: ${ip} - ${record.count} requests in ${timeSinceFirst}ms`);
    res.status(429).json({
      error: 'Suspicious activity detected. Please try again later.',
    });
    return;
  }

  next();
};

// DDoS protection middleware
export const ddosProtection = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const ip = req.ip || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';

  // Check for missing or suspicious user agents
  if (!userAgent || userAgent === 'unknown') {
    logger.warn(`Request with missing user agent from IP: ${ip}`);
  }

  // Check for suspicious patterns
  const suspiciousPatterns = [
    /bot/i,
    /crawler/i,
    /spider/i,
    /scraper/i,
  ];

  const isSuspicious = suspiciousPatterns.some((pattern) => pattern.test(userAgent));

  if (isSuspicious) {
    logger.info(`Potential bot detected: ${userAgent} from ${ip}`);
    // You might want to apply stricter rate limiting here
    // For now, we'll just log it
  }

  // Check request size
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  const maxSize = 10 * 1024 * 1024; // 10MB

  if (contentLength > maxSize) {
    logger.warn(`Large request detected from IP: ${ip} - Size: ${contentLength} bytes`);
    res.status(413).json({
      error: 'Request entity too large',
    });
    return;
  }

  next();
};

// Clean up old records periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  const cleanupThreshold = 5 * 60 * 1000; // 5 minutes

  for (const [ip, record] of requestCounts.entries()) {
    if (now - record.firstRequest > cleanupThreshold) {
      requestCounts.delete(ip);
    }
  }
}, 5 * 60 * 1000);

// IP whitelist middleware (for trusted IPs like monitoring services)
const whitelistedIPs = (process.env.WHITELISTED_IPS || '').split(',').filter(Boolean);

export const ipWhitelist = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const ip = req.ip || '';

  if (whitelistedIPs.includes(ip)) {
    // Skip rate limiting for whitelisted IPs
    next();
    return;
  }

  next();
};

// Request pattern analysis
const requestPatterns = new Map<string, string[]>();

export const patternAnalysis = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const ip = req.ip || 'unknown';
  const path = req.path;
  const now = Date.now().toString();

  if (!requestPatterns.has(ip)) {
    requestPatterns.set(ip, []);
  }

  const patterns = requestPatterns.get(ip)!;
  patterns.push(`${path}:${now}`);

  // Keep only last 100 requests
  if (patterns.length > 100) {
    patterns.shift();
  }

  // Check for repetitive patterns (same endpoint hit many times)
  const recentPaths = patterns.slice(-20).map((p) => p.split(':')[0]);
  const pathCounts = recentPaths.reduce((acc, p) => {
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const maxRepetition = Math.max(...Object.values(pathCounts));

  if (maxRepetition > 15) {
    logger.warn(`Repetitive pattern detected from IP: ${ip} - Path hit ${maxRepetition} times`);
  }

  next();
};

// Clean up pattern records periodically
setInterval(() => {
  requestPatterns.clear();
}, 10 * 60 * 1000); // Clear every 10 minutes
