/**
 * backend.ts - the API client that talks to the AccessApply backend.
 *
 * Real workflow:
 *   POST /api/agent/tasks                  (start task: command + pageContext)
 *   POST /api/agent/tasks/:taskId/continue (subsequent turn: pageContext)
 *   POST /api/agent/tasks/:taskId/respond  (user answer: answer)
 *   GET  /health                           (lightweight health check)
 *   GET  /api/auth/me                      (verify session)
 *   POST /api/auth/login                   (login session)
 *   POST /api/auth/register                (register session)
 *   POST /api/auth/logout                  (logout session)
 *
 * All authenticated requests send `credentials: "include"` so the session cookie
 * (`accessapply_session`) is transmitted securely.
 */

import type {
  ActionError,
  AgentAction,
  AgentTask,
  ExtensionSettings,
  PageContext,
} from "./types.js";
import { validateAction, validateUrl } from "./validate.js";

/** Data sent to the backend. No credentials, no form secrets. */
export interface NextActionRequest {
  sessionId: string;
  iteration: number;
  page: PageContext;
  client?: Record<string, unknown>;
}

export type NextActionResponse =
  | { ok: true; action: AgentAction; source: "backend" | "mock" }
  | { ok: false; error: ActionError };

export type TaskActionResponse =
  | { ok: true; task: AgentTask; action: AgentAction; source?: "backend" | "mock" }
  | { ok: false; error: ActionError };

export interface AuthUser {
  id: string;
  email: string;
}

const REQUEST_TIMEOUT_MS = 25_000;

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

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Real Multi-Turn Agent API
// ---------------------------------------------------------------------------

/** Start a new multi-turn task on the backend. */
export async function createAgentTask(
  settings: ExtensionSettings,
  command: string,
  pageContext: PageContext,
  userProfile?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<TaskActionResponse> {
  if (settings.mockMode) {
    const mockRes = mockNextAction(settings, {
      sessionId: "mock",
      iteration: 1,
      page: pageContext,
    });
    if (!mockRes.ok) return { ok: false, error: mockRes.error };
    const mockTask: AgentTask = {
      id: "mock-task-1",
      userId: "mock-user",
      command,
      status:
        mockRes.action.action === "done"
          ? "completed"
          : mockRes.action.action === "ask_user"
            ? "waiting_for_user"
            : "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return { ok: true, task: mockTask, action: mockRes.action, source: "mock" };
  }

  const url = buildUrl(settings.backendUrl, "/api/agent/tasks");
  if (!url) {
    return {
      ok: false,
      error: error("BACKEND_UNAVAILABLE", "Backend URL is invalid."),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        command,
        pageContext: sanitizePageForWire(pageContext),
        ...(userProfile ? { userProfile } : {}),
      }),
      signal: controller.signal,
    });

    if (response.status === 401) {
      return {
        ok: false,
        error: error(
          "REQUIRES_AUTHORIZATION",
          "Authentication required. Please log in to AccessApply.",
          "401 Unauthorized",
        ),
      };
    }

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

    const data: unknown = await response.json();
    if (!data || typeof data !== "object") {
      return {
        ok: false,
        error: error("INVALID_BACKEND_RESPONSE", "Backend returned an empty response."),
      };
    }

    const record = data as Record<string, unknown>;
    const task = record["task"] as AgentTask;
    const validated = validateAction(record["action"]);
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

    return { ok: true, task, action: validated.value, source: "backend" };
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

/** Continue an active task with a newly observed PageContext. */
export async function continueAgentTask(
  settings: ExtensionSettings,
  taskId: string,
  pageContext: PageContext,
  userProfile?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<TaskActionResponse> {
  if (settings.mockMode) {
    const mockRes = mockNextAction(settings, {
      sessionId: "mock",
      iteration: 2,
      page: pageContext,
    });
    if (!mockRes.ok) return { ok: false, error: mockRes.error };
    const mockTask: AgentTask = {
      id: taskId,
      userId: "mock-user",
      command: "mock command",
      status:
        mockRes.action.action === "done"
          ? "completed"
          : mockRes.action.action === "ask_user"
            ? "waiting_for_user"
            : "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return { ok: true, task: mockTask, action: mockRes.action, source: "mock" };
  }

  const url = buildUrl(settings.backendUrl, `/api/agent/tasks/${taskId}/continue`);
  if (!url) {
    return {
      ok: false,
      error: error("BACKEND_UNAVAILABLE", "Backend URL is invalid."),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        pageContext: sanitizePageForWire(pageContext),
        ...(userProfile ? { userProfile } : {}),
      }),
      signal: controller.signal,
    });

    if (response.status === 401) {
      return {
        ok: false,
        error: error(
          "REQUIRES_AUTHORIZATION",
          "Authentication required. Please log in to AccessApply.",
          "401 Unauthorized",
        ),
      };
    }

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

    const data: unknown = await response.json();
    if (!data || typeof data !== "object") {
      return {
        ok: false,
        error: error("INVALID_BACKEND_RESPONSE", "Backend returned an empty response."),
      };
    }

    const record = data as Record<string, unknown>;
    const task = record["task"] as AgentTask;
    const validated = validateAction(record["action"]);
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

    return { ok: true, task, action: validated.value, source: "backend" };
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

/** Answer an ask_user question and resume the task. */
export async function respondToAgentTask(
  settings: ExtensionSettings,
  taskId: string,
  answer: string,
  userProfile?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<TaskActionResponse> {
  const url = buildUrl(settings.backendUrl, `/api/agent/tasks/${taskId}/respond`);
  if (!url) {
    return {
      ok: false,
      error: error("BACKEND_UNAVAILABLE", "Backend URL is invalid."),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        answer: answer.trim(),
        ...(userProfile ? { userProfile } : {}),
      }),
      signal: controller.signal,
    });

    if (response.status === 401) {
      return {
        ok: false,
        error: error(
          "REQUIRES_AUTHORIZATION",
          "Authentication required. Please log in to AccessApply.",
          "401 Unauthorized",
        ),
      };
    }

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

    const data: unknown = await response.json();
    if (!data || typeof data !== "object") {
      return {
        ok: false,
        error: error("INVALID_BACKEND_RESPONSE", "Backend returned an empty response."),
      };
    }

    const record = data as Record<string, unknown>;
    const task = record["task"] as AgentTask;
    const validated = validateAction(record["action"]);
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

    return { ok: true, task, action: validated.value, source: "backend" };
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

// ---------------------------------------------------------------------------
// Authentication API
// ---------------------------------------------------------------------------

export async function getAuthStatus(
  settings: ExtensionSettings,
): Promise<{ authenticated: boolean; user?: AuthUser; error?: string }> {
  if (settings.mockMode) {
    return { authenticated: true, user: { id: "mock-user", email: "demo@accessapply.com" } };
  }
  const url = buildUrl(settings.backendUrl, "/api/auth/me");
  if (!url) return { authenticated: false, error: "Invalid backend URL" };
  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
    });
    if (!response.ok) return { authenticated: false };
    const data = (await response.json()) as { authenticated?: boolean; user?: AuthUser };
    return {
      authenticated: data.authenticated === true,
      user: data.user,
    };
  } catch (err) {
    return { authenticated: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function loginUser(
  settings: ExtensionSettings,
  email: string,
  password: string,
): Promise<{ ok: boolean; user?: AuthUser; error?: string }> {
  const url = buildUrl(settings.backendUrl, "/api/auth/login");
  if (!url) return { ok: false, error: "Invalid backend URL" };
  try {
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    const data = (await response.json()) as { success?: boolean; user?: AuthUser; error?: string };
    if (!response.ok || !data.success) {
      return { ok: false, error: data.error || `HTTP ${response.status}` };
    }
    return { ok: true, user: data.user };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function registerUser(
  settings: ExtensionSettings,
  email: string,
  password: string,
): Promise<{ ok: boolean; user?: AuthUser; error?: string }> {
  const url = buildUrl(settings.backendUrl, "/api/auth/register");
  if (!url) return { ok: false, error: "Invalid backend URL" };
  try {
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    const data = (await response.json()) as { success?: boolean; user?: AuthUser; error?: string };
    if (!response.ok || !data.success) {
      return { ok: false, error: data.error || `HTTP ${response.status}` };
    }
    return { ok: true, user: data.user };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function logoutUser(settings: ExtensionSettings): Promise<{ ok: boolean }> {
  const url = buildUrl(settings.backendUrl, "/api/auth/logout");
  if (!url) return { ok: false };
  try {
    await fetch(url, {
      method: "POST",
      credentials: "include",
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Health probe used by the popup to show backend reachability. */
export async function checkHealth(
  settings: ExtensionSettings,
): Promise<{ ok: boolean; detail: string }> {
  if (settings.mockMode)
    return { ok: true, detail: "Mock mode (offline)" };
  if (!settings.backendUrl)
    return { ok: false, detail: "No backend URL" };
  const url = buildUrl(settings.backendUrl, settings.healthPath || "/health");
  if (!url) return { ok: false, detail: "Invalid URL" };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
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

/** Backwards-compatibility wrapper for smoke tests and single step testing. */
export async function requestNextAction(
  settings: ExtensionSettings,
  request: NextActionRequest,
  signal?: AbortSignal,
): Promise<NextActionResponse> {
  const res = await createAgentTask(
    settings,
    "Find a job and apply",
    request.page,
    undefined,
    signal,
  );
  if (!res.ok) {
    return { ok: false, error: res.error };
  }
  return { ok: true, action: res.action, source: res.source || "backend" };
}

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

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

export function mockNextAction(
  settings: ExtensionSettings,
  request: NextActionRequest,
): NextActionResponse {
  const scenario = settings.mockScenario as MockScenario;

  if (scenario === "invalid_action") {
    return {
      ok: true,
      action: { action: "click" } as unknown as AgentAction,
      source: "mock",
    };
  }
  if (scenario === "invalid_response") {
    return {
      ok: false,
      error: error("INVALID_BACKEND_RESPONSE", "Simulated invalid response."),
    };
  }
  if (scenario === "backend_error") {
    return {
      ok: false,
      error: error("BACKEND_ERROR", "Simulated 500 error from backend."),
    };
  }

  const elements = request.page.elements;
  const firstButton = elements.find((e) => e.type === "button");
  const firstInput = elements.find((e) => e.type === "input");

  if (scenario === "type" && firstInput) {
    return {
      ok: true,
      action: {
        action: "type",
        target: firstInput.id,
        value: "Software Engineer",
      },
      source: "mock",
    };
  }

  if (scenario === "scroll") {
    return {
      ok: true,
      action: { action: "scroll", direction: "down" },
      source: "mock",
    };
  }

  if (scenario === "navigate") {
    return {
      ok: true,
      action: { action: "navigate", url: "http://localhost:5173/jobs" },
      source: "mock",
    };
  }

  if (scenario === "read") {
    return {
      ok: true,
      action: { action: "read" },
      source: "mock",
    };
  }

  if (scenario === "auto") {
    if (request.iteration === 1 && firstInput) {
      return {
        ok: true,
        action: { action: "type", target: firstInput.id, value: "Software Engineer" },
        source: "mock",
      };
    }
    if (request.iteration === 2 && firstButton) {
      return {
        ok: true,
        action: { action: "click", target: firstButton.id },
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
    return {
      ok: true,
      action: { action: "done" },
      source: "mock",
    };
  }

  if (firstButton) {
    return {
      ok: true,
      action: { action: "click", target: firstButton.id },
      source: "mock",
    };
  }

  return {
    ok: true,
    action: { action: "done" },
    source: "mock",
  };
}

/** Retrieve the stored UserProfile from the backend database. */
export async function getUserProfile(
  settings: ExtensionSettings,
  signal?: AbortSignal,
): Promise<{ ok: true; profile: Record<string, unknown> } | { ok: false; error: ActionError }> {
  const url = buildUrl(settings.backendUrl, "/api/profile");
  if (!url) {
    return { ok: false, error: error("BACKEND_UNAVAILABLE", "Backend URL is invalid.") };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (res.status === 401) {
      return { ok: false, error: error("REQUIRES_AUTHORIZATION", "Authentication required.") };
    }
    if (!res.ok) {
      return { ok: false, error: error("BACKEND_ERROR", `Failed to fetch profile: ${res.status}`) };
    }
    const data = (await res.json()) as { success?: boolean; profile?: Record<string, unknown> };
    if (data.profile) {
      return { ok: true, profile: data.profile };
    }
    return { ok: false, error: error("BACKEND_ERROR", "No profile data returned.") };
  } catch (err) {
    return {
      ok: false,
      error: error("BACKEND_UNAVAILABLE", "Could not reach backend profile.", String(err)),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Save or update the UserProfile in the backend database. */
export async function saveUserProfile(
  settings: ExtensionSettings,
  profile: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ ok: true; profile: Record<string, unknown> } | { ok: false; error: ActionError }> {
  const url = buildUrl(settings.backendUrl, "/api/profile");
  if (!url) {
    return { ok: false, error: error("BACKEND_UNAVAILABLE", "Backend URL is invalid.") };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const res = await fetch(url, {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(profile),
      signal: controller.signal,
    });
    if (res.status === 401) {
      return { ok: false, error: error("REQUIRES_AUTHORIZATION", "Authentication required.") };
    }
    if (!res.ok) {
      const errBody = await safeText(res);
      return { ok: false, error: error("BACKEND_ERROR", `Failed to save profile: ${res.status}`, errBody) };
    }
    const data = (await res.json()) as { success?: boolean; profile?: Record<string, unknown> };
    return { ok: true, profile: data.profile || profile };
  } catch (err) {
    return {
      ok: false,
      error: error("BACKEND_UNAVAILABLE", "Could not reach backend profile.", String(err)),
    };
  } finally {
    clearTimeout(timer);
  }
}
