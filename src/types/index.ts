import { Request } from 'express';

export interface AuthRequest extends Request {
  userId?: string;
  organizationId?: string;
  userRole?: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}
