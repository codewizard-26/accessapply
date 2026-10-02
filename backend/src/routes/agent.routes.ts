import { Router, type Request, type Response } from "express";
import type { PageContext, UserProfile } from "../../../shared/types/index.js";
import { getNextAction } from "../agent/agent.service.js";

export const agentRouter = Router();

interface AgentRequestBody {
  command: string;
  pageContext: PageContext;
  userProfile?: UserProfile;
}

/**
 * POST /api/agent/act
 * 
 * Receives the user command, webpage context, and user profile from the browser extension,
 * validates the input, and delegates action determination to the AgentService.
 */
agentRouter.post("/act", async (req: Request<unknown, unknown, AgentRequestBody>, res: Response) => {
  const { command, pageContext, userProfile } = req.body;

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
    // Delegate to AgentService
    const action = await getNextAction(command, pageContext, userProfile);

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
});
