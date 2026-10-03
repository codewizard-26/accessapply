/**
 * content.ts - the only code that touches the page DOM.
 *
 * Responsibilities:
 *  - Answer SCAN_PAGE with a fresh PageContext.
 *  - Execute EXECUTE_ACTION via actions.ts, which revalidates every target.
 *  - Survive being injected/removed; hold no durable state.
 *
 * It never runs arbitrary code received from the backend and never fetches.
 */

import {
  executeAction,
  readPage,
  waitForPageSettle,
} from "./actions.js";
import { initOverlay, updateOverlay } from "./overlay.js";
import { validateAction } from "./validate.js";
import type {
  ActionResult,
  ContentActionResponse,
  ContentMessage,
  ContentScanResponse,
  ExtensionSettings,
  PageContext,
} from "./types.js";

const SETTINGS_KEY = "accessapplySettings";

/** Read the current settings snapshot pushed down by the service worker. */
let cachedSettings: ExtensionSettings | null = null;

chrome.runtime.onMessage.addListener(
  (
    message: ContentMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    try {
      switch (message.type) {
        case "SCAN_PAGE": {
          const page: PageContext = readPage();
          sendResponse({
            ok: true,
            page,
          } satisfies ContentScanResponse);
          return undefined;
        }
        case "EXECUTE_ACTION": {
          const validated = validateAction(message.action);
          if (!validated.ok) {
            const result: ActionResult = {
              ok: false,
              error: { code: "INVALID_ACTION", message: validated.error },
            };
            sendResponse({ ok: false, result } satisfies ContentActionResponse);
            return undefined;
          }
          const ctx = {
            allowConsequentialActions:
              cachedSettings?.allowConsequentialActions ?? false,
          };
          const result = executeAction(validated.value, ctx);
          sendResponse({
            ok: result.ok,
            result,
          } satisfies ContentActionResponse);
          return undefined;
        }
        case "GET_STATE": {
          sendResponse({
            ok: true,
            result: {
              url: location.href,
              title: document.title,
              readyState: document.readyState,
            },
          });
          return undefined;
        }
        case "UPDATE_OVERLAY": {
          updateOverlay(message.state);
          sendResponse({ ok: true });
          return undefined;
        }
        default: {
          sendResponse({
            ok: false,
            error: { code: "INVALID_ACTION", message: "Unknown message." },
          });
          return undefined;
        }
      }
    } catch (err) {
      const message2 = err instanceof Error ? err.message : String(err);
      sendResponse({
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Content script error.",
          detail: message2,
        },
      });
      return undefined;
    }
  },
);

// The service worker may have been restarted; re-read settings on demand.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[SETTINGS_KEY]) {
    cachedSettings =
      (changes[SETTINGS_KEY]?.newValue as ExtensionSettings | undefined) ??
      null;
  }
});

void chrome.storage.local.get(SETTINGS_KEY).then((items) => {
  cachedSettings =
    (items[SETTINGS_KEY] as ExtensionSettings | undefined) ?? null;
});

// Re-scan readiness notification: lets the service worker know the page moved.
window.addEventListener("pageshow", () => {
  void waitForPageSettle(0);
});

// Initialize in-page AccessApply overlay
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initOverlay());
} else {
  initOverlay();
}
