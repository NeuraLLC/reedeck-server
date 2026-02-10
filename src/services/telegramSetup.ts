import crypto from 'crypto';

/**
 * In-memory store for Telegram setup codes.
 * Each code maps an organization to a pending Telegram group connection.
 * Codes expire after 10 minutes and are single-use.
 */
const setupCodes = new Map<string, { organizationId: string; expiresAt: number }>();

// Clean up expired codes every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of setupCodes.entries()) {
    if (now > data.expiresAt) setupCodes.delete(code);
  }
}, 5 * 60 * 1000);

export function generateSetupCode(organizationId: string): string {
  // Remove any existing code for this org
  for (const [code, data] of setupCodes.entries()) {
    if (data.organizationId === organizationId) setupCodes.delete(code);
  }

  const code = crypto.randomBytes(3).toString('hex').toUpperCase(); // e.g. "A3F1B2"
  setupCodes.set(code, {
    organizationId,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  return code;
}

export function validateSetupCode(code: string): string | null {
  const data = setupCodes.get(code.toUpperCase());
  if (!data || Date.now() > data.expiresAt) return null;
  setupCodes.delete(code.toUpperCase()); // single-use
  return data.organizationId;
}
