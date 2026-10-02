import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

let aiClient: GoogleGenAI | null = null;

/**
 * Retrieves or creates the Gemini client using the GEMINI_API_KEY environment variable.
 * Throws a clear error if the API key is missing.
 */
function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing from environment variables.");
  }

  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
  }

  return aiClient;
}

/**
 * Sends a prompt to the Gemini API and returns the generated text.
 * Uses a suitable current Gemini model available on the free tier.
 *
 * @param prompt The prompt to send to the model.
 * @returns The generated text from the model.
 */
export async function generateText(prompt: string): Promise<string> {
  const ai = getGeminiClient();

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
    contents: prompt,
  });

  return response.text ?? "";
}
