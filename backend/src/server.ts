import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { agentRouter } from "./routes/agent.routes.js";
import { generateAgentAction } from "./services/llm.service.js";

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

// Temporary Gemini test endpoint
app.get("/api/test-gemini", async (_req, res) => {
  try {
    const action = await generateAgentAction("User wants to navigate to https://example.com");
    res.json({
      success: true,
      result: action,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

// Agent routes
app.use("/api/agent", agentRouter);

// Start server
app.listen(PORT, () => {
  console.log(`AccessApply backend running on http://localhost:${PORT}`);
});