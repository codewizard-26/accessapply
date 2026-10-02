import { Router, type Request, type Response } from "express";
import type { UserProfile } from "../../../shared/types/index.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  getStoredUserProfile,
  upsertUserProfile,
} from "../services/profile.service.js";

export const profileRouter = Router();

// Protect all profile endpoints with persistent session authentication
profileRouter.use(requireAuth);

/**
 * GET /api/profile
 * Retrieves the currently authenticated user's profile from Neon PostgreSQL.
 */
profileRouter.get("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;

  try {
    const profile = await getStoredUserProfile(userId);

    res.json({
      success: true,
      profile,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to retrieve profile";
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * PUT /api/profile
 * Saves or updates the profile for the currently authenticated user.
 * Derives user identity strictly from the authenticated session (never from req.body).
 */
profileRouter.put(
  "/",
  async (req: Request<unknown, unknown, UserProfile>, res: Response) => {
    const userId = req.user!.id;
    const profileData = req.body;

    if (!profileData || !profileData.name || !profileData.email) {
      res.status(400).json({
        success: false,
        error: "Missing required profile fields: name and email are required.",
      });
      return;
    }

    try {
      const saved = await upsertUserProfile(userId, profileData);

      res.json({
        success: true,
        profile: saved,
        message: "Profile saved successfully",
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to save profile";
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);
