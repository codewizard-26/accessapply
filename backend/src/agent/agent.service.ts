import type {
  AgentAction,
  PageContext,
  PageElement,
  UserProfile,
} from "../../../shared/types/index.js";
import { generateAgentAction } from "../services/llm.service.js";

/**
 * Constructs a structured prompt for Gemini containing the user's command,
 * current webpage context, available interactive elements, and optional user profile.
 */
function buildAgentPrompt(
  command: string,
  pageContext: PageContext,
  userProfile?: UserProfile
): string {
  const elementsFormatted =
    pageContext.elements && pageContext.elements.length > 0
      ? JSON.stringify(pageContext.elements, null, 2)
      : "No interactive elements detected on this page.";

  const profileSection = userProfile
    ? `\n### User Profile:\n${JSON.stringify(userProfile, null, 2)}\n`
    : "\n### User Profile:\nNo user profile provided.\n";

  return `You are the AI decision-making brain of AccessApply, an assistive accessibility agent that helps users with disabilities navigate job websites and complete job applications.

### User Command:
"${command}"

### Current Webpage Context:
- URL: ${pageContext.url}
- Page Title: ${pageContext.title || "Untitled"}
- Page Text Content:
${pageContext.text || "No text content available."}

### Available Page Elements:
${elementsFormatted}
${profileSection}
### Decision Instructions:
1. You must select exactly ONE next action from the allowed AgentAction types:
   - navigate: { "action": "navigate", "url": string }
   - click: { "action": "click", "target": string }
   - type: { "action": "type", "target": string, "value": string }
   - scroll: { "action": "scroll", "direction": "up" | "down" }
   - read: { "action": "read", "target"?: string }
   - ask_user: { "action": "ask_user", "question": string }
   - done: { "action": "done" }

2. Target Selection:
   - Use ONLY the elements listed in the "Available Page Elements" section when choosing a "target".
   - Identify the element by its 'id' attribute where available, or by its exact text / label.

3. Handling Missing or Sensitive Information:
   - Do NOT guess or fabricate user details (such as phone numbers, addresses, SSN, salary expectations, or authorization).
   - If required information is not present in the User Profile, issue an "ask_user" action with a concise, clear question.

4. Security and Human-in-the-Loop:
   - Do NOT attempt to solve or bypass CAPTCHAs, two-factor authentication (2FA), login challenges, or other security verification mechanisms.
   - If any security barrier or CAPTCHA is encountered, use the "ask_user" action to request user assistance.

5. Completion:
   - If the user command has already been fully satisfied or the workflow is finished, return { "action": "done" }.

6. Format:
   - Return ONLY the structured AgentAction JSON object. No explanations, no markdown wrapper, and no JavaScript.`;
}

/**
 * Checks whether a given target identifier matches any element in the page context.
 * Performs exact matching first against element id, text, label, or placeholder.
 */
function isTargetInPageElements(target: string, elements: PageElement[]): boolean {
  if (!target || elements.length === 0) {
    return false;
  }

  // 1. Exact match first
  for (const el of elements) {
    if (
      el.id === target ||
      el.text === target ||
      el.label === target ||
      el.placeholder === target
    ) {
      return true;
    }
  }

  // 2. Safe trimmed match fallback
  const trimmedTarget = target.trim();
  for (const el of elements) {
    if (
      (el.id && el.id.trim() === trimmedTarget) ||
      (el.text && el.text.trim() === trimmedTarget) ||
      (el.label && el.label.trim() === trimmedTarget) ||
      (el.placeholder && el.placeholder.trim() === trimmedTarget)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Semantic validation layer:
 * Verifies that actions referencing a page element (click, type, read with target)
 * actually point to a real element present in pageContext.elements.
 */
function validateActionAgainstPageContext(
  action: AgentAction,
  pageContext: PageContext
): void {
  const elements = pageContext.elements || [];

  switch (action.action) {
    case "click":
    case "type": {
      if (!isTargetInPageElements(action.target, elements)) {
        throw new Error(
          `Invalid agent target: "${action.target}" does not exist in the current page context.`
        );
      }
      break;
    }
    case "read": {
      if (action.target && !isTargetInPageElements(action.target, elements)) {
        throw new Error(
          `Invalid agent target: "${action.target}" does not exist in the current page context.`
        );
      }
      break;
    }
    case "navigate":
    case "scroll":
    case "ask_user":
    case "done":
      // These actions do not reference page elements; skip target validation.
      break;
  }
}

/**
 * Decides the next structured action for the agent to execute based on
 * the user command, page context, and user profile by consulting Gemini,
 * and semantically validates that any referenced targets exist on the page.
 *
 * @param command The high-level instruction or intent from the user.
 * @param pageContext Current state of the webpage, including URL, text, and DOM elements.
 * @param userProfile Optional profile information for the user (skills, contact, preferences).
 * @returns A Promise resolving to a validated structured AgentAction.
 */
export async function getNextAction(
  command: string,
  pageContext: PageContext,
  userProfile?: UserProfile
): Promise<AgentAction> {
  const prompt = buildAgentPrompt(command, pageContext, userProfile);
  const action = await generateAgentAction(prompt);

  // Semantic validation: Ensure referenced target exists in page elements
  validateActionAgainstPageContext(action, pageContext);

  return action;
}
