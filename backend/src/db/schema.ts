import { pgTable, text, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import crypto from "node:crypto";
import type { AccessibilityPreferences, UserProfile } from "../../../shared/types/index.js";

/**
 * PostgreSQL schema for AccessApply users.
 */
export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type UserRow = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * PostgreSQL schema for persistent user sessions.
 */
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // Cryptographically random session identifier
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SessionRow = typeof sessions.$inferSelect;
export type InsertSession = typeof sessions.$inferInsert;

/**
 * PostgreSQL schema for persisting UserProfile in Neon database.
 * Each profile is uniquely owned by a user (users.id -> user_profiles.userId).
 */
export const userProfiles = pgTable("user_profiles", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  location: text("location"),
  skills: jsonb("skills").$type<string[]>().default([]).notNull(),
  education: jsonb("education").$type<UserProfile["education"]>(),
  experience: jsonb("experience").$type<UserProfile["experience"]>(),
  resumeUrl: text("resume_url"),
  githubUrl: text("github_url"),
  linkedinUrl: text("linkedin_url"),

  // Accessibility preferences columns
  voiceEnabled: boolean("voice_enabled").default(false).notNull(),
  textToSpeechEnabled: boolean("text_to_speech_enabled").default(false).notNull(),
  simplifiedText: boolean("simplified_text").default(false).notNull(),
  keyboardNavigation: boolean("keyboard_navigation").default(false).notNull(),
  assistanceLevel: text("assistance_level")
    .$type<AccessibilityPreferences["assistanceLevel"]>()
    .default("assist")
    .notNull(),

  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type UserProfileRow = typeof userProfiles.$inferSelect;
export type InsertUserProfile = typeof userProfiles.$inferInsert;

/**
 * Converts a database row into the shared UserProfile TypeScript contract.
 */
export function rowToUserProfile(row: UserProfileRow): UserProfile {
  return {
    name: row.name,
    email: row.email,
    ...(row.phone ? { phone: row.phone } : {}),
    ...(row.location ? { location: row.location } : {}),
    skills: row.skills || [],
    ...(row.education ? { education: row.education } : {}),
    ...(row.experience ? { experience: row.experience } : {}),
    ...(row.resumeUrl ? { resumeUrl: row.resumeUrl } : {}),
    ...(row.githubUrl ? { githubUrl: row.githubUrl } : {}),
    ...(row.linkedinUrl ? { linkedinUrl: row.linkedinUrl } : {}),
    accessibility: {
      voiceEnabled: row.voiceEnabled,
      textToSpeechEnabled: row.textToSpeechEnabled,
      simplifiedText: row.simplifiedText,
      keyboardNavigation: row.keyboardNavigation,
      assistanceLevel: row.assistanceLevel,
    },
  };
}
