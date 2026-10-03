import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { authRouter } from "./routes/auth.routes.js";
import { profileRouter } from "./routes/profile.routes.js";
import { agentRouter } from "./routes/agent.routes.js";

dotenv.config();

export const app = express();

// Known local frontend development origins
const LOCAL_DEV_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:3000",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:4173",
];

/**
 * Validates whether an incoming request Origin is permitted by CORS.
 * Prioritizes CORS_ORIGIN env var, supports Chrome extensions and local dev origins.
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  // Allow requests without Origin header (e.g. extension background scripts, same-origin, curl)
  if (!origin) {
    return true;
  }

  // 1. Check configured CORS_ORIGIN environment variable
  if (process.env.CORS_ORIGIN) {
    const configuredOrigins = process.env.CORS_ORIGIN.split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    if (configuredOrigins.includes(origin)) {
      return true;
    }
  }

  // 2. Allow Chrome extension communication (chrome-extension://<id>)
  if (origin.startsWith("chrome-extension://")) {
    return true;
  }

  // 3. In non-production or when no custom origin is set, allow known local frontend origins
  if (process.env.NODE_ENV !== "production" || !process.env.CORS_ORIGIN) {
    if (LOCAL_DEV_ORIGINS.includes(origin)) {
      return true;
    }
  }

  return false;
}

// Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// Health check
app.get("/health", (_req, res) => {
  res.json({
    success: true,
    message: "AccessApply backend is running",
  });
});

// Authentication routes (register, login, me, logout)
app.use("/api/auth", authRouter);

// Profile routes (GET, PUT)
app.use("/api/profile", profileRouter);

// Agent routes (POST /act, POST /tasks, etc.)
app.use("/api/agent", agentRouter);
