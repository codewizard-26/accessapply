import type { AgentAction, PageContext, UserProfile } from "../../../shared/types/index.js";

/**
 * Decides the next structured action for the agent to execute based on
 * the user command, page context, and user profile.
 *
 * In this phase, this returns a mock action conforming to the AgentAction contract.
 * In upcoming phases, this will query an LLM reasoning engine.
 */
export async function getNextAction(
  command: string,
  pageContext: PageContext,
  userProfile?: UserProfile
): Promise<AgentAction> {
  const mockAction: AgentAction = {
    action: "click",
    target: pageContext.elements?.[0]?.id || "apply-button",
  };

  return mockAction;
}
