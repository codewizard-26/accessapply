import { Router, type Request, type Response } from "express";
import type { AgentAction, PageContext, UserProfile } from "../../../shared/types/index.js";

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
 * and returns the next structured action to execute.
 */
agentRouter.post("/act", (req: Request<unknown, unknown, AgentRequestBody>, res: Response) => {
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

  // Phase 1 Mock Action:
  // Demonstrates returning a structured AgentAction contract
  const mockAction: AgentAction = {
    action: "click",
    target: pageContext.elements?.[0]?.id || "apply-button",
  };

  res.json({
    success: true,
    action: mockAction,
    message: `Received command "${command}" for: ${
      pageContext.title || pageContext.url
    }`,
  });
});
