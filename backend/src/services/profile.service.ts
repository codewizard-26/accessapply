import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userProfiles, rowToUserProfile } from "../db/schema.js";
import type { UserProfile } from "../../../shared/types/index.js";

/**
 * Isolated development user ID for linking database rows
 * without implementing a premature or fake authentication system.
 */
export const DEV_USER_ID = "dev-user-001";

/**
 * Retrieves the stored UserProfile from the database for the given user ID.
 * Defaults to the isolated development user ID.
 */
export async function getStoredUserProfile(
  userId: string = DEV_USER_ID
): Promise<UserProfile | null> {
  const [row] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.id, userId))
    .limit(1);

  if (!row) {
    return null;
  }

  return rowToUserProfile(row);
}

/**
 * Upserts a UserProfile for the given user ID in Neon PostgreSQL.
 */
export async function upsertUserProfile(
  profile: UserProfile,
  userId: string = DEV_USER_ID
): Promise<UserProfile> {
  const values = {
    id: userId,
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
      target: userProfiles.id,
      set: values,
    });

  const updated = await getStoredUserProfile(userId);
  if (!updated) {
    throw new Error("Failed to retrieve profile after upsert");
  }

  return updated;
}
