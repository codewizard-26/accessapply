import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userProfiles, rowToUserProfile } from "../db/schema.js";
import type { UserProfile } from "../../../shared/types/index.js";

/**
 * Retrieves the stored UserProfile from the database for the given authenticated user ID.
 */
export async function getStoredUserProfile(
  userId: string
): Promise<UserProfile | null> {
  const [row] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  if (!row) {
    return null;
  }

  return rowToUserProfile(row);
}

/**
 * Upserts a UserProfile for the authenticated user ID in Neon PostgreSQL.
 */
export async function upsertUserProfile(
  userId: string,
  profile: UserProfile
): Promise<UserProfile> {
  const values = {
    userId,
    name: profile.name,
    email: profile.email,
    phone: profile.phone ?? null,
    location: profile.location ?? null,
    skills: profile.skills || [],
    education: profile.education ?? null,
    experience: profile.experience ?? null,
    resumeUrl: profile.resumeUrl ?? null,
    githubUrl: profile.githubUrl ?? null,
    linkedinUrl: profile.linkedinUrl ?? null,
    voiceEnabled: profile.accessibility?.voiceEnabled ?? false,
    textToSpeechEnabled: profile.accessibility?.textToSpeechEnabled ?? false,
    simplifiedText: profile.accessibility?.simplifiedText ?? false,
    keyboardNavigation: profile.accessibility?.keyboardNavigation ?? false,
    assistanceLevel: profile.accessibility?.assistanceLevel ?? "assist",
    updatedAt: new Date(),
  };

  await db
    .insert(userProfiles)
    .values(values)
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: values,
    });

  const updated = await getStoredUserProfile(userId);
  if (!updated) {
    throw new Error("Failed to retrieve profile after upsert");
  }

  return updated;
}
