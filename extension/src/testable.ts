/**
 * testable.ts - re-exports the browser-free modules so `npm test` can exercise
 * them under Node. Importing this file must not pull in any chrome.* API.
 */

export {
  validateAction,
  validateSettings,
  validateUrl,
  DEFAULT_SETTINGS,
} from "./validate.js";
export {
  mockNextAction,
  sanitizePageForWire,
  MOCK_SCENARIOS,
} from "./backend.js";
export {
  classifyTargetRisk,
  hasExplicitUserAuthorization,
  buildSafeRecoveryAction,
  createActionFailureKey,
} from "./actions.js";
export { detectWorkMode } from "./scanner.js";
export type {
  AgentAction,
  ExtensionSettings,
  PageContext,
  PageElement,
} from "./types.js";
