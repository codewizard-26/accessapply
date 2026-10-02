import { Router, type Request, type Response } from "express";
import type { UserProfile } from "../../../shared/types/index.js";
import {
  getStoredUserProfile,
  upsertUserProfile,
} from "../services/profile.service.js";

export const profileRouter = Router();

/**
 * GET /api/profile
 * Retrieves the currently saved UserProfile from Neon PostgreSQL.
 */
profileRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const profile = await getStoredUserProfile();

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
 * Saves or updates the UserProfile in Neon PostgreSQL.
 */
profileRouter.put("/", async (req: Request<unknown, unknown, UserProfile>, res: Response) => {
  const profileData = req.body;

  if (!profileData || !profileData.name || !profileData.email) {
    res.status(400).json({
      success: false,
      error: "Missing required profile fields: name and email are required.",
    });
    return;
  }

  try {
    const saved = await upsertUserProfile(profileData);

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
});
