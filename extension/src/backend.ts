/**
 * backend.ts - the only place that talks to the AccessApply backend.
 *
 * Contract (all routes are configurable in `ExtensionSettings`):
 *   POST {backendUrl}{nextActionPath}   body: { sessionId, iteration, page }
 *                                        200:  { action: <AgentAction> } (or the
 *                                              bare AgentAction, or { data: ... })
 *   GET  {backendUrl}{healthPath}       200:  anything truthy
 *
 * The backend owns all AI reasoning. This client never interprets intent; it
 * only ships a structured page and validates whatever comes back via
 * `validateAction` (see validate.ts) before it reaches the page.
 *
 * Mock mode short-circuits all of this and works with no backend running.
 */

import type {
  ActionError,
  AgentAction,
  ExtensionSettings,
  PageContext,
} from "./types.js";
import { validateAction, validateUrl } from "./validate.js";

/** Data sent to the backend. No credentials, no form secrets. */
export interface NextActionRequest {
  sessionId: string;
  iteration: number;
  page: PageContext;
  /** Free-form channel for UI-side state (never personal profile data). */
  client?: Record<string, unknown>;
}

export type NextActionResponse =
  | { ok: true; action: AgentAction; source: "backend" | "mock" }
  | { ok: false; error: ActionError };

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Redact a page context before it leaves the browser.
 * Defence in depth: the scanner already omits these, but a mutation in the
 * scanner should not silently start shipping passwords.
 */
export function sanitizePageForWire(page: PageContext): PageContext {
  const elements = page.elements.map((el) => {
    const copy = { ...el };
    const t = (copy.inputType ?? "").toLowerCase();
    if (t === "password" || t === "file" || t === "hidden") {
      delete copy.value;
    }
    if (copy.value && looksSensitive(copy)) delete copy.value;
    return copy;
  });
  return { ...page, elements };
}

function looksSensitive(el: {
  label?: string;
  placeholder?: string;
  name?: string;
  type?: string;
}): boolean {
  const hint = `${el.label ?? ""} ${el.placeholder ?? ""}`.toLowerCase();
  if (!hint) return false;
  return /(password|passcode|otp|one[- ]time|cvv|card ?number|ssn|social security|security code|pin\b)/.test(
    hint,
  );
}

function buildUrl(base: string, path: string): string | null {
  const baseCheck = validateUrl(base);
  if (!baseCheck.ok) return null;
  const pathCheck = validateUrl(
    `${baseCheck.value.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`,
  );
  return pathCheck.ok ? pathCheck.value : null;
}

function error(
  code: ActionError["code"],
  message: string,
  detail?: string,
): ActionError {
  return { code, message, detail };
}

/** Ask the backend (or the mock) for the next action. Never throws. */
export async function requestNextAction(
  settings: ExtensionSettings,
  request: NextActionRequest,
  signal?: AbortSignal,
): Promise<NextActionResponse> {
  if (settings.mockMode) {
    return mockNextAction(settings, request);
  }

  if (!settings.backendUrl) {
    return {
      ok: false,
      error: error(
        "BACKEND_UNAVAILABLE",
        "No backend URL configured.",
        "Set a backend URL in the popup, or enable mock mode.",
      ),
    };
  }

  const url = buildUrl(settings.backendUrl, settings.nextActionPath);
  if (!url) {
    return {
      ok: false,
      error: error("BACKEND_UNAVAILABLE", "Backend URL or route is invalid."),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) controller.abort();
    else
      signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        ...request,
        page: sanitizePageForWire(request.page),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await safeText(response);
      return {
        ok: false,
        error: error(
          "BACKEND_ERROR",
          `Backend responded with ${response.status}.`,
          body.slice(0, 300),
        ),
      };
    }

    const body: unknown = await response.json();
    const validated = validateAction(body);
    if (!validated.ok) {
      return {
        ok: false,
        error: error(
          "INVALID_BACKEND_RESPONSE",
          "Backend returned an unsupported action.",
          validated.error,
        ),
      };
    }
    return { ok: true, action: validated.value, source: "backend" };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return {
        ok: false,
        error: error("TIMEOUT", "Backend request timed out or was cancelled."),
      };
    }
    return {
      ok: false,
      error: error(
        "BACKEND_UNAVAILABLE",
        "Could not reach the backend.",
        err instanceof Error ? err.message : String(err),
      ),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/** Health probe used by the popup to show backend reachability. */
export async function checkHealth(
  settings: ExtensionSettings,
): Promise<{ ok: boolean; detail: string }> {
  if (settings.mockMode)
    return { ok: true, detail: "Mock mode - no network calls." };
  if (!settings.backendUrl)
    return { ok: false, detail: "No backend URL configured." };
  const url = buildUrl(settings.backendUrl, settings.healthPath);
  if (!url) return { ok: false, detail: "Invalid backend URL or health path." };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return { ok: response.ok, detail: `HTTP ${response.status}` };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

/** Scenarios selectable from the popup. `auto` walks the whole flow. */
export const MOCK_SCENARIOS = [
  "click",
  "type",
  "scroll",
  "navigate",
  "read",
  "auto",
  "invalid_action",
  "invalid_response",
  "backend_error",
] as const;

export type MockScenario = (typeof MOCK_SCENARIOS)[number];

/**
 * Deterministic mock action chooser.
 *
 * `auto` walks a scripted sequence so the full loop
 * (read -> act -> read) can be exercised with no backend at all.
 */
export function mockNextAction(
  settings: ExtensionSettings,
  request: NextActionRequest,
): NextActionResponse {
  const scenario = settings.mockScenario as MockScenario;

  if (scenario === "invalid_action") {
    // Action that fails validation on purpose.
    return {
      ok: true,
      action: { action: "click" } as unknown as AgentAction,
      source: "mock",
    };
  }
  if (scenario === "invalid_response") {
    return {
      ok: false,
      error: error(
        "INVALID_BACKEND_RESPONSE",
        "Mock: deliberately invalid response.",
      ),
    };
  }
  if (scenario === "backend_error") {
    return {
      ok: false,
      error: error(
        "BACKEND_ERROR",
        "Mock: simulated backend failure (HTTP 500).",
      ),
    };
  }

  const elements = request.page.elements;
  const findButton = (re: RegExp) =>
    elements.find(
      (el) =>
        el.type === "button" && re.test(el.accessibleName ?? el.text ?? ""),
    );
  const findField = (re: RegExp) =>
    elements.find(
      (el) =>
        el.type === "input" &&
        re.test(`${el.label ?? ""} ${el.placeholder ?? ""}`),
    );

  if (scenario === "auto") {
    // Iteration 1: fill the first labelled field. 2: click an apply-ish button.
    // 3: scroll. 4: done.
    const field = findField(/email|e-mail/i);
    if (request.iteration <= 1 && field) {
      return {
        ok: true,
        action: {
          action: "type",
          target: field.id,
          value: "test.user@example.com",
        },
        source: "mock",
      };
    }
    const applyButton = findButton(/show|view|details|apply/i);
    if (request.iteration === 2 && applyButton) {
      return {
        ok: true,
        action: { action: "click", target: applyButton.id },
        source: "mock",
      };
    }
    if (request.iteration === 3) {
      return {
        ok: true,
        action: { action: "scroll", direction: "down" },
        source: "mock",
      };
    }
    return { ok: true, action: { action: "done" }, source: "mock" };
  }

  switch (scenario) {
    case "click": {
      const target =
        findButton(/apply|submit|show|view|details|more|next/i) ??
        elements.find((el) => el.type === "button") ??
        elements.find((el) => el.type === "link");
      if (!target) {
        return {
          ok: false,
          error: error(
            "INVALID_BACKEND_RESPONSE",
            "Mock: no clickable element found on this page.",
          ),
        };
      }
      return {
        ok: true,
        action: { action: "click", target: target.id },
        source: "mock",
      };
    }
    case "type": {
      const target =
        findField(/full ?name|name|email/i) ??
        elements.find((el) => el.type === "input");
      if (!target) {
        return {
          ok: false,
          error: error(
            "INVALID_BACKEND_RESPONSE",
            "Mock: no text input found on this page.",
          ),
        };
      }
      return {
        ok: true,
        action: {
          action: "type",
          target: target.id,
          value:
            target.inputType === "email"
              ? "test.user@example.com"
              : "Test User",
        },
        source: "mock",
      };
    }
    case "scroll":
      return {
        ok: true,
        action: { action: "scroll", direction: "down" },
        source: "mock",
      };
    case "navigate": {
      // Always a safe, already-known-safe destination for the test page.
      const url = buildUrl(request.page.url, "#details") ?? request.page.url;
      return { ok: true, action: { action: "navigate", url }, source: "mock" };
    }
    case "read":
    default:
      return { ok: true, action: { action: "read" }, source: "mock" };
  }
}
