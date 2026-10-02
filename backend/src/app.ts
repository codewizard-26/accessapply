import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { authRouter } from "./routes/auth.routes.js";
import { profileRouter } from "./routes/profile.routes.js";
import { agentRouter } from "./routes/agent.routes.js";

dotenv.config();

export const app = express();

// Middleware
app.use(
  cors({
    origin: true,
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
