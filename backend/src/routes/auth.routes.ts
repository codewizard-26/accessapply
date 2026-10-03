import { Router, type Request, type Response } from "express";
import {
  createUser,
  findUserByEmail,
  hashPassword,
  verifyPassword,
  createSession,
  validateSession,
  invalidateSession,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE_NAME,
} from "../services/auth.service.js";

export const authRouter = Router();

interface RegisterRequestBody {
  email: string;
  password: string;
}

interface LoginRequestBody {
  email: string;
  password: string;
}

/**
 * POST /api/auth/register
 * Creates a new user account, immediately authenticates the user,
 * sets a persistent session cookie, and returns safe user information.
 */
authRouter.post(
  "/register",
  async (req: Request<unknown, unknown, RegisterRequestBody>, res: Response) => {
    const { email, password } = req.body;

    if (!email || !email.includes("@")) {
      res.status(400).json({
        success: false,
        error: "A valid email address is required.",
      });
      return;
    }

    if (!password || password.length < 6) {
      res.status(400).json({
        success: false,
        error: "Password must be at least 6 characters long.",
      });
      return;
    }

    try {
      const existingUser = await findUserByEmail(email);
      if (existingUser) {
        res.status(409).json({
          success: false,
          error: "An account with this email already exists.",
        });
        return;
      }

      const passwordHash = await hashPassword(password);
      const newUser = await createUser(email, passwordHash);

      // Automatically authenticate the newly registered user
      const sessionId = await createSession(newUser.id);
      setSessionCookie(res, sessionId);

      res.status(201).json({
        success: true,
        user: {
          id: newUser.id,
          email: newUser.email,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to register user";
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);

/**
 * POST /api/auth/login
 * Verifies credentials, creates a persistent session, and sets the secure HttpOnly cookie.
 */
authRouter.post(
  "/login",
  async (req: Request<unknown, unknown, LoginRequestBody>, res: Response) => {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        success: false,
        error: "Email and password are required.",
      });
      return;
    }

    try {
      const user = await findUserByEmail(email);
      if (!user) {
        res.status(401).json({
          success: false,
          error: "Invalid email or password.",
        });
        return;
      }

      const isValidPassword = await verifyPassword(password, user.passwordHash);
      if (!isValidPassword) {
        res.status(401).json({
          success: false,
          error: "Invalid email or password.",
        });
        return;
      }

      // Create persistent session
      const sessionId = await createSession(user.id);
      setSessionCookie(res, sessionId);

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to log in";
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);

/**
 * GET /api/auth/me
 * Checks whether the current caller possesses a valid, unexpired session cookie.
 */
authRouter.get("/me", async (req: Request, res: Response) => {
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME];

  if (!sessionId) {
    res.status(401).json({
      success: false,
      authenticated: false,
      error: "No active session found.",
    });
    return;
  }

  try {
    const result = await validateSession(sessionId);
    if (!result) {
      clearSessionCookie(res);
      res.status(401).json({
        success: false,
        authenticated: false,
        error: "Session is invalid or has expired.",
      });
      return;
    }

    res.json({
      authenticated: true,
      user: {
        id: result.user.id,
        email: result.user.email,
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to verify session";
    res.status(500).json({
      success: false,
      authenticated: false,
      error: errorMessage,
    });
  }
});

/**
 * POST /api/auth/logout
 * Invalidates the current session in the database and clears the authentication cookie.
 */
authRouter.post("/logout", async (req: Request, res: Response) => {
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME];

  try {
    if (sessionId) {
      await invalidateSession(sessionId);
    }
  } catch {
    // Continue clearing cookie even if session was already deleted
  } finally {
    clearSessionCookie(res);
    res.json({
      success: true,
      message: "Logged out successfully",
    });
  }
});
