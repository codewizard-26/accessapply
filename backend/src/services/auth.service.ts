import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { eq, and, gt } from "drizzle-orm";
import type { Response } from "express";
import { db } from "../db/index.js";
import { users, sessions, type SessionRow, type UserRow } from "../db/schema.js";

export const SESSION_COOKIE_NAME = "accessapply_session";
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Returns cookie options for secure, persistent session authentication.
 */
export function getSessionCookieOptions() {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? ("none" as const) : ("lax" as const),
    maxAge: SESSION_DURATION_MS,
    path: "/",
  };
}

/**
 * Sets the persistent session cookie on the response.
 */
export function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(SESSION_COOKIE_NAME, sessionId, getSessionCookieOptions());
}

/**
 * Clears the session cookie from the client.
 */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    ...getSessionCookieOptions(),
    maxAge: 0,
  });
}

/**
 * Hashes a plaintext password using bcrypt with salt rounds = 10.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Compares a candidate password with the stored bcrypt hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Finds a user by email address.
 */
export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1);

  return user || null;
}

/**
 * Creates a new user record in the database.
 */
export async function createUser(
  email: string,
  passwordHash: string
): Promise<{ id: string; email: string }> {
  const [created] = await db
    .insert(users)
    .values({
      email: email.toLowerCase().trim(),
      passwordHash,
    })
    .returning({
      id: users.id,
      email: users.email,
    });

  if (!created) {
    throw new Error("Failed to create user");
  }

  return created;
}

/**
 * Creates a cryptographically random session token and stores it in the database.
 */
export async function createSession(userId: string): Promise<string> {
  const sessionId = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    expiresAt,
  });

  return sessionId;
}

/**
 * Validates a session token against the database.
 * Returns the authenticated user if the session exists and has not expired.
 */
export async function validateSession(
  sessionId: string
): Promise<{ user: { id: string; email: string }; session: SessionRow } | null> {
  const now = new Date();

  const [record] = await db
    .select({
      session: sessions,
      user: {
        id: users.id,
        email: users.email,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
    .limit(1);

  if (!record) {
    return null;
  }

  return record;
}

/**
 * Deletes a session token from the database.
 */
export async function invalidateSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}
