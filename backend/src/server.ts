import dotenv from "dotenv";
import { app } from "./app.js";

dotenv.config();

const PORT = process.env.PORT || 5000;

if (!process.env.DATABASE_URL) {
  console.error("FATAL: DATABASE_URL is not set in environment variables.");
  process.exit(1);
}

if (!process.env.GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY is not set. AI agent requests will fail.");
}

// Start server
app.listen(PORT, () => {
  console.log(`AccessApply backend running on http://localhost:${PORT}`);
});