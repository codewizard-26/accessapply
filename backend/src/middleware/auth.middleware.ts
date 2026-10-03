import type { Request, Response, NextFunction } from "express";
import {
  validateSession,
  SESSION_COOKIE_NAME,
} from "../services/auth.service.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Middleware that requires a valid, persistent session cookie.
 * Rejects unauthenticated requests with HTTP 401.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME];

  if (!sessionId) {
    res.status(401).json({
      success: false,
      authenticated: false,
      error: "Authentication required. Please log in or register.",
    });
    return;
  }

  const result = await validateSession(sessionId);
  if (!result) {
    res.status(401).json({
      success: false,
      authenticated: false,
      error: "Invalid or expired session. Please log in again.",
    });
    return;
  }

  req.user = result.user;
  next();
}

/**
 * Optional authentication helper: identifies user if session is present,
 * but allows unauthenticated execution to proceed.
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME];

  if (sessionId) {
    const result = await validateSession(sessionId);
    if (result) {
      req.user = result.user;
    }
  }

  next();
}
