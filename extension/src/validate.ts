/**
 * validate.ts - runtime validation for data crossing a trust boundary.
 *
 * Everything arriving from the backend (or persisted in storage) is treated as
 * untrusted input. No backend-provided JavaScript is ever evaluated, and only
 * the whitelisted action shapes below are accepted.
 */

import type {
  AgentAction,
  ExtensionSettings,
  ScrollDirection,
} from "./types.js";

export interface ValidationOk<T> {
  ok: true;
  value: T;
}

export interface ValidationErr {
  ok: false;
  error: string;
}

export type ValidationResult<T> = ValidationOk<T> | ValidationErr;

function fail(error: string): ValidationErr {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

const SCROLL_DIRECTIONS: ScrollDirection[] = ["up", "down", "top", "bottom"];
const MAX_VALUE_LENGTH = 2000;
const MAX_URL_LENGTH = 2048;

/** Validate a backend "next action" response body. */
export function validateAction(input: unknown): ValidationResult<AgentAction> {
  if (!isRecord(input)) return fail("Action must be an object.");

  // Tolerate a wrapper such as { "action": { ... } } or { "data": { ... } }.
  let payload: Record<string, unknown> = input;
  if (isRecord(input["action"]) && typeof input["action"] !== "string") {
    payload = input["action"] as Record<string, unknown>;
  } else if (
    isRecord(input["data"]) &&
    typeof input["action"] === "undefined"
  ) {
    payload = input["data"] as Record<string, unknown>;
  }

  const kind = asString(payload["action"]) ?? asString(input["action"]);
  if (!kind) return fail("Missing 'action' field.");

  const reason = asString(payload["reason"]);
  const withReason = <T extends object>(obj: T): T =>
    reason ? ({ ...obj, reason } as T) : obj;

  switch (kind) {
    case "click": {
      const target = asString(payload["target"]);
      if (!target) return fail("click requires 'target'.");
      if (target.length > 128) return fail("click target too long.");
      return {
        ok: true,
        value: withReason({ action: "click", target }) as AgentAction,
      };
    }
    case "type": {
      const target = asString(payload["target"]);
      const value = payload["value"];
      if (!target) return fail("type requires 'target'.");
      if (typeof value !== "string")
        return fail("type requires a string 'value'.");
      if (value.length > MAX_VALUE_LENGTH) return fail("type value too long.");
      const append = payload["append"] === true;
      const blur = payload["blur"] === false ? false : true;
      return {
        ok: true,
        value: withReason({
          action: "type",
          target,
          value,
          append,
          blur,
        }) as AgentAction,
      };
    }
    case "scroll": {
      const direction = asString(payload["direction"]);
      if (!direction) return fail("scroll requires 'direction'.");
      if (!SCROLL_DIRECTIONS.includes(direction as ScrollDirection)) {
        return fail(
          `scroll direction must be one of ${SCROLL_DIRECTIONS.join(", ")}.`,
        );
      }
      const amountRaw = payload["amount"];
      let amount: number | undefined;
      if (amountRaw !== undefined && amountRaw !== null) {
        const n = Number(amountRaw);
        if (!Number.isFinite(n) || n <= 0 || n > 20000)
          return fail("scroll amount out of range.");
        amount = Math.round(n);
      }
      const target = asString(payload["target"]);
      return {
        ok: true,
        value: withReason({
          action: "scroll",
          direction: direction as ScrollDirection,
          amount,
          target,
        }) as AgentAction,
      };
    }
    case "navigate": {
      const url = asString(payload["url"]);
      if (!url) return fail("navigate requires 'url'.");
      if (url.length > MAX_URL_LENGTH) return fail("navigate url too long.");
      if (!/^https?:\/\//i.test(url))
        return fail("Only http/https URLs are allowed.");
      const newTab = payload["newTab"] === true;
      return {
        ok: true,
        value: withReason({ action: "navigate", url, newTab }) as AgentAction,
      };
    }
    case "read": {
      const target = asString(payload["target"]);
      if (target && target.length > 128) return fail("read target too long.");
      return {
        ok: true,
        value: withReason({ action: "read", target }) as AgentAction,
      };
    }
    case "ask_user": {
      const question = asString(payload["question"]);
      if (!question) return fail("ask_user requires 'question'.");
      if (question.length > MAX_VALUE_LENGTH) return fail("question too long.");
      return { ok: true, value: { action: "ask_user", question } };
    }
    case "done":
      return { ok: true, value: withReason({ action: "done" }) as AgentAction };
    default:
      return fail(`Unsupported action "${kind}".`);
  }
}

/** Allow only absolute http/https URLs, rejecting javascript:, data:, etc. */
export function validateUrl(raw: string): ValidationResult<string> {
  const trimmed = (raw || "").trim();
  if (!trimmed) return fail("Empty URL.");
  if (trimmed.length > MAX_URL_LENGTH) return fail("URL too long.");
  if (/^\s*javascript:/i.test(trimmed))
    return fail("javascript: URLs are not allowed.");
  if (/^\s*data:/i.test(trimmed)) return fail("data: URLs are not allowed.");
  if (/^\s*vbscript:/i.test(trimmed))
    return fail("vbscript: URLs are not allowed.");
  if (/^\s*file:/i.test(trimmed)) return fail("file: URLs are not allowed.");

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return fail("Malformed URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return fail("Only http and https are allowed.");
  }
  return { ok: true, value: parsed.toString() };
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  backendUrl: "http://localhost:5000",
  nextActionPath: "/api/agent/next-action",
  healthPath: "/api/health",
  mockMode: true,
  mockScenario: "click",
  maxIterations: 10,
  waitAfterActionMs: 600,
  pageSettleTimeoutMs: 5000,
  allowConsequentialActions: false,
  fontSize: "normal",
  highContrast: false,
  reducedMotion: false,
  speechSynthesisEnabled: true,
  voiceCommandsEnabled: false,
  screenReaderMode: false,
  plainLanguageMode: false,
  autoSpeakSummaries: false,
  allowedOrigins: [],
};

/** Validate persisted/user-supplied settings, filling defaults. */
export function validateSettings(
  input: unknown,
): ValidationResult<ExtensionSettings> {
  if (!isRecord(input)) return { ok: true, value: { ...DEFAULT_SETTINGS } };

  const base = { ...DEFAULT_SETTINGS };

  const backendUrl = asString(input["backendUrl"]);
  if (backendUrl !== undefined) {
    if (!backendUrl.trim()) {
      base.backendUrl = "";
    } else {
      const urlCheck = validateUrl(backendUrl);
      if (!urlCheck.ok) return fail(`backendUrl invalid: ${urlCheck.error}`);
      base.backendUrl = urlCheck.value.replace(/\/+$/, "");
    }
  }

  const nextActionPath = asString(input["nextActionPath"]);
  if (nextActionPath !== undefined && nextActionPath.trim()) {
    if (!nextActionPath.startsWith("/"))
      return fail("nextActionPath must start with '/'.");
    base.nextActionPath = nextActionPath;
  }

  const healthPath = asString(input["healthPath"]);
  if (healthPath !== undefined && healthPath.trim()) {
    if (!healthPath.startsWith("/"))
      return fail("healthPath must start with '/'.");
    base.healthPath = healthPath;
  }

  if (typeof input["mockMode"] === "boolean") base.mockMode = input["mockMode"];

  const mockScenario = asString(input["mockScenario"]);
  if (mockScenario) base.mockScenario = mockScenario;

  const maxIterations = Number(input["maxIterations"]);
  if (Number.isFinite(maxIterations)) {
    base.maxIterations = Math.min(Math.max(Math.round(maxIterations), 1), 50);
  }

  const waitAfter = Number(input["waitAfterActionMs"]);
  if (Number.isFinite(waitAfter))
    base.waitAfterActionMs = Math.min(Math.max(waitAfter, 0), 30000);

  const settle = Number(input["pageSettleTimeoutMs"]);
  if (Number.isFinite(settle))
    base.pageSettleTimeoutMs = Math.min(Math.max(settle, 500), 60000);

  if (typeof input["allowConsequentialActions"] === "boolean") {
    base.allowConsequentialActions = input["allowConsequentialActions"];
  }

  const fontSize = asString(input["fontSize"]);
  if (fontSize === "normal" || fontSize === "large" || fontSize === "x-large") {
    base.fontSize = fontSize;
  }

  if (typeof input["highContrast"] === "boolean") {
    base.highContrast = input["highContrast"];
  }
  if (typeof input["reducedMotion"] === "boolean") {
    base.reducedMotion = input["reducedMotion"];
  }
  if (typeof input["speechSynthesisEnabled"] === "boolean") {
    base.speechSynthesisEnabled = input["speechSynthesisEnabled"];
  }
  if (typeof input["voiceCommandsEnabled"] === "boolean") {
    base.voiceCommandsEnabled = input["voiceCommandsEnabled"];
  }
  if (typeof input["screenReaderMode"] === "boolean") {
    base.screenReaderMode = input["screenReaderMode"];
  }
  if (typeof input["plainLanguageMode"] === "boolean") {
    base.plainLanguageMode = input["plainLanguageMode"];
  }
  if (typeof input["autoSpeakSummaries"] === "boolean") {
    base.autoSpeakSummaries = input["autoSpeakSummaries"];
  }

  if (Array.isArray(input["allowedOrigins"])) {
    const origins: string[] = [];
    for (const entry of input["allowedOrigins"]) {
      const s = asString(entry);
      if (!s) continue;
      try {
        const u = new URL(s);
        if (u.protocol === "http:" || u.protocol === "https:")
          origins.push(u.origin);
      } catch {
        /* ignore malformed origin entries */
      }
    }
    base.allowedOrigins = origins;
  }

  return { ok: true, value: base };
}
