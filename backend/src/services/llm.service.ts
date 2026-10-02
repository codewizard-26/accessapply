import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import type { AgentAction } from "../../../shared/types/index.js";

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
 * Schema matching the AgentAction union type for Gemini structured output.
 */
const agentActionSchema = {
  anyOf: [
    {
      type: Type.OBJECT,
      description: "Navigate to a specified URL",
      properties: {
        action: { type: Type.STRING, enum: ["navigate"] },
        url: { type: Type.STRING, description: "Destination URL to open" },
      },
      required: ["action", "url"],
    },
    {
      type: Type.OBJECT,
      description: "Click an interactive element on the page",
      properties: {
        action: { type: Type.STRING, enum: ["click"] },
        target: { type: Type.STRING, description: "Element identifier or descriptor to click" },
      },
      required: ["action", "target"],
    },
    {
      type: Type.OBJECT,
      description: "Type a value into an input field",
      properties: {
        action: { type: Type.STRING, enum: ["type"] },
        target: { type: Type.STRING, description: "Target input field identifier or name" },
        value: { type: Type.STRING, description: "Value to type into the field" },
      },
      required: ["action", "target", "value"],
    },
    {
      type: Type.OBJECT,
      description: "Scroll the page up or down",
      properties: {
        action: { type: Type.STRING, enum: ["scroll"] },
        direction: { type: Type.STRING, enum: ["up", "down"] },
      },
      required: ["action", "direction"],
    },
    {
      type: Type.OBJECT,
      description: "Read content or inspect an element on the page",
      properties: {
        action: { type: Type.STRING, enum: ["read"] },
        target: { type: Type.STRING, description: "Optional target element or section to read" },
      },
      required: ["action"],
    },
    {
      type: Type.OBJECT,
      description: "Ask the user a clarifying or sensitive question",
      properties: {
        action: { type: Type.STRING, enum: ["ask_user"] },
        question: { type: Type.STRING, description: "Question to present to the user" },
      },
      required: ["action", "question"],
    },
    {
      type: Type.OBJECT,
      description: "Indicate that the current task is completed",
      properties: {
        action: { type: Type.STRING, enum: ["done"] },
      },
      required: ["action"],
    },
  ],
};

/**
 * Validates that an object conforms to the AgentAction shape.
 */
function isValidAgentAction(action: any): action is AgentAction {
  if (!action || typeof action !== "object") return false;

  switch (action.action) {
    case "navigate":
      return typeof action.url === "string";
    case "click":
      return typeof action.target === "string";
    case "type":
      return typeof action.target === "string" && typeof action.value === "string";
    case "scroll":
      return action.direction === "up" || action.direction === "down";
    case "read":
      return action.target === undefined || typeof action.target === "string";
    case "ask_user":
      return typeof action.question === "string";
    case "done":
      return true;
    default:
      return false;
  }
}

let mockActionGenerator: ((prompt: string) => Promise<AgentAction>) | null = null;

/**
 * Test utility to set a custom mock generator for AgentActions.
 * Pass null to restore real Gemini API execution.
 */
export function setMockActionGenerator(
  mock: ((prompt: string) => Promise<AgentAction>) | null
): void {
  mockActionGenerator = mock;
}

/**
 * Sends a prompt to the Gemini API and returns a structured AgentAction.
 *
 * @param prompt The prompt describing the page and desired goal.
 * @returns The structured AgentAction selected by Gemini.
 */
export async function generateAgentAction(prompt: string): Promise<AgentAction> {
  if (mockActionGenerator) {
    const mocked = await mockActionGenerator(prompt);
    if (!isValidAgentAction(mocked)) {
      throw new Error(
        `Invalid AgentAction structure received: ${JSON.stringify(mocked)}`
      );
    }
    return mocked;
  }

  const ai = getGeminiClient();

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-3.8-flash-lite",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: agentActionSchema,
    },
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Gemini returned an empty response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse Gemini response as JSON: ${text}`);
  }

  if (!isValidAgentAction(parsed)) {
    throw new Error(`Invalid AgentAction structure received from Gemini: ${text}`);
  }

  return parsed;
}
