import { Router, type Request, type Response } from "express";
import type { PageContext, UserProfile } from "../../../shared/types/index.js";
import {
  getNextAction,
  startAgentTask,
  continueAgentTask,
  respondToAgentTask,
  getAgentTask,
  TaskNotFoundError,
  TaskForbiddenError,
  TaskStateError,
} from "../agent/agent.service.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { rowToAgentTask } from "../db/schema.js";

export const agentRouter = Router();

// Protect all agent endpoints with session authentication
agentRouter.use(requireAuth);

interface StartTaskRequestBody {
  command: string;
  pageContext: PageContext;
  userProfile?: UserProfile;
}

interface ContinueTaskRequestBody {
  pageContext: PageContext;
  userProfile?: UserProfile;
}

interface RespondTaskRequestBody {
  answer: string;
  userProfile?: UserProfile;
}

interface SingleActRequestBody {
  command: string;
  pageContext: PageContext;
  userProfile?: UserProfile;
}

/**
 * POST /api/agent/tasks
 *
 * Stage 1: Creates and initializes a persistent agent task.
 * Derives user identity strictly from req.user.id (from the session cookie).
 * Loads user profile, queries Gemini, validates action against pageContext,
 * creates the task in Neon, and returns the task ID, status, and first action.
 */
agentRouter.post(
  "/tasks",
  async (req: Request<unknown, unknown, StartTaskRequestBody>, res: Response) => {
    const { command, pageContext, userProfile } = req.body;
    const userId = req.user!.id;

    if (!command || typeof command !== "string" || !command.trim()) {
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
      const result = await startAgentTask(userId, command.trim(), pageContext, userProfile);

      res.status(201).json({
        success: true,
        task: {
          id: result.task.id,
          status: result.task.status,
        },
        action: result.action,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to start agent task";
      const isValidationError = errorMessage.startsWith("Invalid agent target");
      res.status(isValidationError ? 400 : 500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);

/**
 * POST /api/agent/tasks/:taskId/continue
 *
 * Stage 2: Continues an existing running task using the NEW PageContext from the extension.
 * Authenticates request via requireAuth.
 * Validates that task belongs to req.user.id.
 * Validates task state (must be running; completed/failed/waiting_for_user are rejected).
 * Generates next AgentAction using Gemini with task history and NEW PageContext.
 * Semantically validates action against NEW PageContext.
 * Updates task state in Neon and returns next action.
 */
agentRouter.post(
  "/tasks/:taskId/continue",
  async (
    req: Request<{ taskId: string }, unknown, ContinueTaskRequestBody>,
    res: Response
  ) => {
    const { taskId } = req.params;
    const { pageContext, userProfile } = req.body;
    const userId = req.user!.id;

    if (!taskId) {
      res.status(400).json({
        success: false,
        error: "Missing required URL parameter: taskId",
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
      const result = await continueAgentTask(taskId, userId, pageContext, userProfile);

      res.json({
        success: true,
        task: {
          id: result.task.id,
          status: result.task.status,
        },
        action: result.action,
      });
    } catch (error) {
      if (error instanceof TaskNotFoundError) {
        res.status(404).json({ success: false, error: error.message });
        return;
      }
      if (error instanceof TaskForbiddenError) {
        res.status(403).json({ success: false, error: error.message });
        return;
      }
      if (error instanceof TaskStateError) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }

      const errorMessage =
        error instanceof Error ? error.message : "Failed to continue agent task";
      const isValidationError = errorMessage.startsWith("Invalid agent target");
      res.status(isValidationError ? 400 : 500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);

/**
 * POST /api/agent/tasks/:taskId/respond
 *
 * Stage 3: Allows a user to answer an ask_user action and resume the task.
 * Authenticates request via requireAuth.
 * Validates non-empty string answer.
 * Verifies task belongs to req.user.id.
 * Verifies status === "waiting_for_user" (running, completed, failed return HTTP 400).
 * Uses the task's most recent stored PageContext.
 * Generates ONE next AgentAction using Gemini with user answer as data context.
 * Semantically validates action against latest stored PageContext.
 * Updates task state in Neon and returns next action.
 */
agentRouter.post(
  "/tasks/:taskId/respond",
  async (
    req: Request<{ taskId: string }, unknown, RespondTaskRequestBody>,
    res: Response
  ) => {
    const { taskId } = req.params;
    const { answer, userProfile } = req.body;
    const userId = req.user!.id;

    if (!taskId) {
      res.status(400).json({
        success: false,
        error: "Missing required URL parameter: taskId",
      });
      return;
    }

    if (!answer || typeof answer !== "string" || !answer.trim()) {
      res.status(400).json({
        success: false,
        error: "Missing or empty required field: answer",
      });
      return;
    }

    try {
      const result = await respondToAgentTask(taskId, userId, answer.trim(), userProfile);

      res.json({
        success: true,
        task: {
          id: result.task.id,
          status: result.task.status,
        },
        action: result.action,
      });
    } catch (error) {
      if (error instanceof TaskNotFoundError) {
        res.status(404).json({ success: false, error: error.message });
        return;
      }
      if (error instanceof TaskForbiddenError) {
        res.status(403).json({ success: false, error: error.message });
        return;
      }
      if (error instanceof TaskStateError) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }

      const errorMessage =
        error instanceof Error ? error.message : "Failed to respond to agent task";
      const isValidationError = errorMessage.startsWith("Invalid agent target");
      res.status(isValidationError ? 400 : 500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);

/**
 * GET /api/agent/tasks/:taskId
 *
 * Stage 1: Retrieves the current status, history, and metadata of a specific task.
 * Verifies that the task belongs to the authenticated user (prevents cross-user access).
 */
agentRouter.get(
  "/tasks/:taskId",
  async (req: Request<{ taskId: string }>, res: Response) => {
    const { taskId } = req.params;
    const userId = req.user!.id;

    try {
      const task = await getAgentTask(userId, taskId);
      if (!task) {
        res.status(404).json({
          success: false,
          error: `Task with ID "${taskId}" not found`,
        });
        return;
      }

      res.json({
        success: true,
        task: rowToAgentTask(task),
        history: task.history,
        lastAction: task.lastAction,
      });
    } catch (error) {
      if (error instanceof TaskForbiddenError) {
        res.status(403).json({ success: false, error: error.message });
        return;
      }
      const errorMessage =
        error instanceof Error ? error.message : "Failed to retrieve task";
      res.status(500).json({ success: false, error: errorMessage });
    }
  }
);

/**
 * POST /api/agent/act
 *
 * Backward-compatible single-step agent action endpoint.
 * Receives the user command, webpage context, and optional user profile.
 * Automatically retrieves stored profile from Neon PostgreSQL if omitted.
 */
agentRouter.post(
  "/act",
  async (req: Request<unknown, unknown, SingleActRequestBody>, res: Response) => {
    const { command, pageContext, userProfile } = req.body;
    const userId = req.user!.id;

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
