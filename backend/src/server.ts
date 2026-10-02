import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { agentRouter } from "./routes/agent.routes.js";
import { profileRouter } from "./routes/profile.routes.js";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({
    success: true,
    message: "AccessApply backend is running",
  });
});

// Profile routes
app.use("/api/profile", profileRouter);

// Agent routes
app.use("/api/agent", agentRouter);

// Start server
app.listen(PORT, () => {
  console.log(`AccessApply backend running on http://localhost:${PORT}`);
});