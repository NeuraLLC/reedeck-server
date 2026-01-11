import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';
import prisma from '../config/database';

// In-memory blacklist (in production, use Redis or database)
const blacklistedIPs = new Set<string>();

// Violation tracking
interface ViolationRecord {
  count: number;
  lastViolation: number;
  reasons: string[];
}

const violations = new Map<string, ViolationRecord>();

// Thresholds
const VIOLATION_THRESHOLD = 10; // Number of violations before blacklist
const VIOLATION_WINDOW = 60 * 60 * 1000; // 1 hour
const BLACKLIST_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Track a violation for an IP address
 */
export function trackViolation(ip: string, reason: string): void {
  const now = Date.now();
  const record = violations.get(ip);

  if (!record) {
    violations.set(ip, {
      count: 1,
      lastViolation: now,
      reasons: [reason],
    });
    return;
  }

  // Reset if outside violation window
  if (now - record.lastViolation > VIOLATION_WINDOW) {
    violations.set(ip, {
      count: 1,
      lastViolation: now,
      reasons: [reason],
    });
    return;
  }

  // Increment violation count
  record.count += 1;
  record.lastViolation = now;
  record.reasons.push(reason);

  // Blacklist if threshold exceeded
  if (record.count >= VIOLATION_THRESHOLD) {
    blacklistIP(ip, `Exceeded violation threshold: ${record.reasons.join(', ')}`);
  }
}

/**
 * Add an IP to the blacklist
 */
export function blacklistIP(ip: string, reason: string): void {
  if (blacklistedIPs.has(ip)) {
    return; // Already blacklisted
  }

  blacklistedIPs.add(ip);
  logger.error(`IP blacklisted: ${ip} - Reason: ${reason}`);

  // Auto-remove after duration
  setTimeout(() => {
    blacklistedIPs.delete(ip);
    violations.delete(ip);
    logger.info(`IP removed from blacklist: ${ip}`);
  }, BLACKLIST_DURATION);
}

/**
 * Remove an IP from the blacklist (manual override)
 */
export function removeFromBlacklist(ip: string): void {
  blacklistedIPs.delete(ip);
  violations.delete(ip);
  logger.info(`IP manually removed from blacklist: ${ip}`);
}

/**
 * Check if an IP is blacklisted
 */
export function isBlacklisted(ip: string): boolean {
  return blacklistedIPs.has(ip);
}

/**
 * Middleware to block blacklisted IPs
 */
export const ipBlacklistMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const ip = req.ip || 'unknown';

  if (isBlacklisted(ip)) {
    logger.warn(`Blocked request from blacklisted IP: ${ip}`);
    res.status(403).json({
      error: 'Access denied. Your IP has been temporarily blocked due to suspicious activity.',
    });
    return;
  }

  next();
};

/**
 * Get blacklist statistics
 */
export function getBlacklistStats() {
  return {
    blacklistedIPs: Array.from(blacklistedIPs),
    violationRecords: Array.from(violations.entries()).map(([ip, record]) => ({
      ip,
      ...record,
    })),
  };
}

// Clean up old violation records periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of violations.entries()) {
    if (now - record.lastViolation > VIOLATION_WINDOW) {
      violations.delete(ip);
    }
  }
}, 10 * 60 * 1000); // Every 10 minutes
