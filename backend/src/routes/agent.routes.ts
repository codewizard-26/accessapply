import { Router, type Request, type Response } from "express";
import type { PageContext, UserProfile } from "../../../shared/types/index.js";
import { getNextAction } from "../agent/agent.service.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const agentRouter = Router();

// Protect agent actuation endpoint with session authentication
agentRouter.use(requireAuth);

interface AgentRequestBody {
  command: string;
  pageContext: PageContext;
  userProfile?: UserProfile;
}

/**
 * POST /api/agent/act
 * 
 * Receives the user command, webpage context, and optional user profile from the browser extension.
 * Derives user identity from the authenticated session cookie, automatically retrieves the
 * stored profile from Neon PostgreSQL, and delegates action determination to the AgentService.
 */
agentRouter.post(
  "/act",
  async (req: Request<unknown, unknown, AgentRequestBody>, res: Response) => {
    const { command, pageContext, userProfile } = req.body;
    const userId = req.user!.id;

    // Validation: ensure command and pageContext with url are provided
    if (!command || !command.trim()) {
      res.status(400).json({
        success: false,
        error: "Missing or empty required field: command",
      });
      return;
    }

    if (!pageContext || !pageContext.url) {
      res.status(400).json({
        success: false,
        error: "Missing required field: pageContext with a valid url",
      });
      return;
    }

    try {
      // Delegate to AgentService with authenticated userId
      const action = await getNextAction(command, pageContext, userProfile, userId);

      res.json({
        success: true,
        action,
        message: `Received command "${command}" for: ${
          pageContext.title || pageContext.url
        }`,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to determine next agent action";
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);
