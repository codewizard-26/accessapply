/**
 * dom-testable.ts - bundles the real scanner + action executor for a page
 * context so `scripts/verify-scanner.mjs` can exercise them against a real
 * DOM in a real browser (Chrome via Playwright), with no extension loaded.
 *
 * This file is only used by the browser test harness. It is never referenced
 * by the manifest, the content script or the service worker, so it does not add
 * anything to the shipped extension.
 */

import {
  executeAction,
  isTargetAlive,
  readPage,
} from "./actions.js";
import {
  mockNextAction,
  MOCK_SCENARIOS,
  sanitizePageForWire,
} from "./backend.js";
import {
  registeredCount,
  resetRegistry,
  resolveElement,
  revalidateElement,
  scanPage,
} from "./scanner.js";
import {
  DEFAULT_SETTINGS,
  validateAction,
  validateSettings,
  validateUrl,
} from "./validate.js";

/** Everything the harness needs, exposed as `window.AA`. */
const api = {
  scanPage,
  readPage,
  resolveElement,
  revalidateElement,
  registeredCount,
  resetRegistry,
  isTargetAlive,
  executeAction,
  validateAction,
  validateSettings,
  validateUrl,
  DEFAULT_SETTINGS,
  mockNextAction,
  sanitizePageForWire,
  MOCK_SCENARIOS,
};

(window as unknown as { AA: typeof api }).AA = api;
