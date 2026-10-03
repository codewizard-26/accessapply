/**
 * background.ts - MV3 service worker: message hub + agent loop.
 *
 * MV3 service workers are killed aggressively, so NOTHING durable lives in a
 * module-level global. State lives in chrome.storage.session (falls back to
 * local semantics via the same API) and is rehydrated lazily on every event.
 *
 * The loop is:
 *   READ -> SEND CONTEXT -> RECEIVE ACTION -> VALIDATE -> EXECUTE
 *        -> WAIT FOR PAGE UPDATE -> READ AGAIN
 *
 * All AI reasoning lives in the backend; this file only orchestrates.
 */

import { checkHealth, requestNextAction } from "./backend.js";
import {
  buildSafeRecoveryAction,
  createActionFailureKey,
} from "./actions.js";
import { validateAction, validateSettings, DEFAULT_SETTINGS } from "./validate.js";
import type {
  ActionError,
  ActionResult,
  AgentAction,
  AgentLogEntry,
  AgentLoopState,
  ContentActionResponse,
  ContentMessage,
  ContentScanResponse,
  ExtensionSettings,
  PageContext,
  PageSummary,
  PopupRequest,
  PopupResponse,
  RuntimeSnapshot,
} from "./types.js";

const SETTINGS_KEY = "accessapplySettings";
const STATE_KEY = "accessapplyState";

const MAX_LOG_ENTRIES = 300;
const MAX_CONSECUTIVE_FAILURES = 3;

interface ActionFailureRecord {
  key: string;
  code: ActionError["code"];
  message: string;
  count: number;
  lastSeen: number;
}

interface PersistedState {
  loop: AgentLoopState;
  logs: AgentLogEntry[];
  lastPage?: PageContext;
  lastAction?: AgentAction;
  lastResult?: ActionResult;
  sessionId: string;
  seq: number;
  tabId?: number;
  recentActionFailures: ActionFailureRecord[];
}

let inMemory: PersistedState | null = null;
/** Guards against concurrent loop runs inside one worker lifetime. */
let loopPromise: Promise<void> | null = null;
const abortControllers = new Set<AbortController>();

// ---------------------------------------------------------------------------
// State persistence (survives service worker restarts)
// ---------------------------------------------------------------------------

function defaultState(): PersistedState {
  return {
    loop: {
      running: false,
      iteration: 0,
      maxIterations: DEFAULT_SETTINGS.maxIterations,
      consecutiveFailures: 0,
    },
    logs: [],
    sessionId: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    seq: 0,
    recentActionFailures: [],
  };
}

async function loadState(): Promise<PersistedState> {
  if (inMemory) return inMemory;
  const stored = await chrome.storage.session.get(STATE_KEY);
  const value = stored[STATE_KEY] as PersistedState | undefined;
  const base = value && typeof value === "object" && value.loop ? value : defaultState();
  if (!Array.isArray(base.recentActionFailures)) base.recentActionFailures = [];
  inMemory = base;
  return inMemory;
}

async function saveState(state: PersistedState): Promise<void> {
  inMemory = state;
  await chrome.storage.session.set({ [STATE_KEY]: state });
}

async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const raw = stored[SETTINGS_KEY];
  const validated = validateSettings(raw ?? DEFAULT_SETTINGS);
  if (!validated.ok) {
    log("error", "Stored settings were invalid; falling back to defaults.", {
      reason: validated.error,
    });
    return { ...DEFAULT_SETTINGS };
  }
  return validated.value;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(
  level: AgentLogEntry["level"],
  message: string,
  data?: unknown,
): void {
  void (async () => {
    const state = await loadState();
    const entry: AgentLogEntry = {
      seq: ++state.seq,
      ts: Date.now(),
      level,
      message,
    };
    if (data !== undefined) entry.data = data;
    state.logs.push(entry);
    if (state.logs.length > MAX_LOG_ENTRIES) {
      state.logs.splice(0, state.logs.length - MAX_LOG_ENTRIES);
    }
    await saveState(state);
    console.log(`[AccessApply] ${message}`, data ?? "");
  })();
}

// ---------------------------------------------------------------------------
// Tab / content script plumbing
// ---------------------------------------------------------------------------

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isInjectableUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /^https?:\/\//i.test(url);
}

async function sendToTab<T>(tabId: number, message: ContentMessage): Promise<T | null> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch {
    return null;
  }
}

/** Ensure a content script exists on the tab (handles tabs opened before install). */
async function ensureContentScript(tab: chrome.tabs.Tab): Promise<boolean> {
  if (!tab.id || !isInjectableUrl(tab.url)) return false;
  const probe = await sendToTab<{ ok: boolean }>(tab.id, { type: "GET_STATE" });
  if (probe?.ok) return true;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    return true;
  } catch {
    return false;
  }
}

async function scanTab(tab: chrome.tabs.Tab): Promise<PageContext | ActionError> {
  if (!(await ensureContentScript(tab))) {
    return {
      code: "UNSUPPORTED_TARGET",
      message: "This page does not allow the extension to run (chrome:// pages and the Web Store are blocked).",
    };
  }
  const response = await sendToTab<ContentScanResponse>(tab.id as number, {
    type: "SCAN_PAGE",
  });
  if (!response) {
    return { code: "INTERNAL_ERROR", message: "No response from the content script." };
  }
  if (!response.ok || !response.page) {
    return response.error ?? { code: "INTERNAL_ERROR", message: "Scan failed." };
  }
  return response.page;
}

async function executeInTab(
  tab: chrome.tabs.Tab,
  action: AgentAction,
): Promise<ActionResult> {
  if (!(await ensureContentScript(tab))) {
    return {
      ok: false,
      action: action.action,
      error: {
        code: "UNSUPPORTED_TARGET",
        message: "Cannot execute actions on this page.",
      },
    };
  }
  const response = await sendToTab<ContentActionResponse>(tab.id as number, {
    type: "EXECUTE_ACTION",
    action,
  });
  if (!response?.result) {
    return {
      ok: false,
      action: action.action,
      error: response?.error ?? {
        code: "INTERNAL_ERROR",
        message: "No response from the content script.",
      },
    };
  }
  return response.result;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait for the tab to finish loading after a navigation. */
async function waitForTabLoad(tabId: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // Give the navigation a moment to start.
  await wait(250);
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") return;
    } catch {
      return; // Tab closed.
    }
    await wait(200);
  }
}

function summarize(page: PageContext): PageSummary {
  return {
    url: page.url,
    title: page.title,
    elementCount: page.elements.length,
    job: page.job,
    textPreview: page.text.slice(0, 240),
  };
}

function recordBlockedAction(
  state: PersistedState,
  action: AgentAction,
  error: ActionError,
): ActionFailureRecord | undefined {
  if (error.code !== "REQUIRES_AUTHORIZATION") return undefined;
  const key = createActionFailureKey(
    {
      action: action.action,
      target:
        action.action === "click" || action.action === "type"
          ? action.target
          : undefined,
    },
    error.code,
  );
  const existing = state.recentActionFailures.find((entry) => entry.key === key);
  if (existing) {
    existing.count += 1;
    existing.message = error.message;
    existing.lastSeen = Date.now();
    return existing;
  }
  const record: ActionFailureRecord = {
    key,
    code: error.code,
    message: error.message,
    count: 1,
    lastSeen: Date.now(),
  };
  state.recentActionFailures.push(record);
  if (state.recentActionFailures.length > 20) {
    state.recentActionFailures = state.recentActionFailures.slice(-20);
  }
  return record;
}

function shouldRecoverWithSafeRead(
  state: PersistedState,
  action: AgentAction,
): boolean {
  const key = createActionFailureKey(
    {
      action: action.action,
      target:
        action.action === "click" || action.action === "type"
          ? action.target
          : undefined,
    },
    "REQUIRES_AUTHORIZATION",
  );
  const record = state.recentActionFailures.find((entry) => entry.key === key);
  return !!record && record.count >= 2;
}

async function buildSnapshot(): Promise<RuntimeSnapshot> {
  const [state, settings, tab] = await Promise.all([
    loadState(),
    loadSettings(),
    getActiveTab(),
  ]);
  const contentScriptReady = tab?.id ? await ensureContentScript(tab) : false;
  return {
    settings,
    loop: state.loop,
    lastPage: state.lastPage,
    logs: state.logs.slice(-80),
    contentScriptReady,
    tabId: tab?.id,
    tabUrl: tab?.url,
  };
}

// ---------------------------------------------------------------------------
// The agent loop
// ---------------------------------------------------------------------------

function resetLoopState(state: PersistedState, settings: ExtensionSettings): void {
  state.loop = {
    running: true,
    iteration: 0,
    maxIterations: settings.maxIterations,
    startedAt: Date.now(),
    consecutiveFailures: 0,
  };
  state.logs = [];
  state.seq = 0;
  state.sessionId = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function runAgentLoop(): Promise<void> {
  if (loopPromise) return loopPromise;

  loopPromise = (async () => {
    const settings = await loadSettings();
    const state = await loadState();
    resetLoopState(state, settings);
    await saveState(state);

    const controller = new AbortController();
    abortControllers.add(controller);
    const tab = await getActiveTab();

    if (!tab?.id) {
      await stopLoop("No active tab.");
      return;
    }
    state.tabId = tab.id;
    await saveState(state);

    log("info", `Agent loop started (mock=${settings.mockMode ? "on" : "off"}).`);

    let currentTabId = tab.id;
    let currentUrl = tab.url ?? "";

    try {
      for (;;) {
        const fresh = await loadState();
        if (!fresh.loop.running || controller.signal.aborted) {
          log("warn", "Loop stopped by user.");
          break;
        }
        if (fresh.loop.iteration >= fresh.loop.maxIterations) {
          await stopLoop(`Reached iteration limit (${fresh.loop.maxIterations}).`);
          break;
        }

        fresh.loop.iteration += 1;
        const iteration = fresh.loop.iteration;
        log("info", `Iteration ${iteration}: reading page.`);

        // 1. READ ---------------------------------------------------------
        let activeTab = await chrome.tabs.get(currentTabId).catch(() => undefined);
        if (!activeTab) {
          await stopLoop("Active tab was closed.");
          break;
        }
        const scanned = await scanTab(activeTab);
        if ("code" in scanned) {
          log("error", `Scan failed: ${scanned.message}`, scanned);
          await stopLoop(scanned.message);
          break;
        }
        const page = scanned;
        fresh.lastPage = page;
        await saveState(fresh);
        log(
          "info",
          `Read "${page.title || page.url}" - ${page.elements.length} elements${
            page.job?.title ? `, job: ${page.job.title}` : ""
          }.`,
        );

        // 2. SEND CONTEXT -> 3. RECEIVE ACTION ---------------------------
        const next = await requestNextAction(
          settings,
          { sessionId: fresh.sessionId, iteration, page },
          controller.signal,
        );
        if (!next.ok) {
          log("error", `Backend error: ${next.error.message}`, next.error);
          fresh.loop.consecutiveFailures += 1;
          fresh.loop.lastError = next.error;
          if (fresh.loop.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            await stopLoop(`Repeated backend failures: ${next.error.message}`);
            break;
          }
          await wait(500 * fresh.loop.consecutiveFailures);
          continue;
        }

        // 4. VALIDATE ----------------------------------------------------
        const validated = validateAction(next.action);
        if (!validated.ok) {
          log("error", `Rejected action: ${validated.error}`);
          fresh.loop.consecutiveFailures += 1;
          fresh.loop.lastError = { code: "INVALID_ACTION", message: validated.error };
          if (fresh.loop.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            await stopLoop("Repeated invalid actions from the backend.");
            break;
          }
          continue;
        }
        const action = validated.value;
        fresh.loop.lastAction = action;
        await saveState(fresh);
        log("info", `Action: ${describeAction(action)}`);

        if (action.action === "done") {
          log("success", "Agent reported done.");
          await stopLoop("Agent completed.");
          break;
        }
        if (action.action === "ask_user") {
          log("warn", `Agent needs input: ${action.question}`);
          await stopLoop(`Agent asked: ${action.question}`);
          break;
        }

        if (shouldRecoverWithSafeRead(fresh, action)) {
          const recovery = buildSafeRecoveryAction(action);
          log(
            "warn",
            "Repeated action detected; selecting a safe alternative.",
            {
              blocked: describeAction(action),
              recovery: describeAction(recovery),
            },
          );
          fresh.loop.lastAction = recovery;
          await saveState(fresh);
          const recoveryResult = await executeInTab(activeTab, recovery);
          fresh.loop.lastResult = recoveryResult;
          fresh.loop.lastError = recoveryResult.ok ? undefined : recoveryResult.error;
          fresh.loop.consecutiveFailures = 0;
          await saveState(fresh);
          if (recoveryResult.ok) {
            log("success", "Recovery: reading job details instead.", recoveryResult.data);
          } else {
            log("warn", "User declined; action cancelled.", recoveryResult.error);
          }
          await wait(settings.waitAfterActionMs);
          continue;
        }

        // 5. EXECUTE -----------------------------------------------------
        const result = await executeInTab(activeTab, action);
        fresh.loop.lastResult = result;
        if (result.ok) {
          log("success", `Executed ${action.action}.`, result.data);
          fresh.loop.consecutiveFailures = 0;
          fresh.loop.lastError = undefined;
        } else {
          if (result.error.code === "REQUIRES_AUTHORIZATION") {
            log(
              "warn",
              "Action blocked: explicit authorization required",
              {
                action: describeAction(action),
                reason: result.error.message,
              },
            );
            recordBlockedAction(fresh, action, result.error);
            fresh.loop.consecutiveFailures = 0;
            fresh.loop.lastError = result.error;
            await saveState(fresh);
            await wait(settings.waitAfterActionMs);
            continue;
          }
          log("error", `Action failed [${result.error.code}]: ${result.error.message}`, result.error);
          fresh.loop.consecutiveFailures += 1;
          fresh.loop.lastError = result.error;
        }
        await saveState(fresh);

        if (fresh.loop.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          await stopLoop(
            `Stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive failures.`,
          );
          break;
        }

        // 6. WAIT FOR PAGE UPDATE ---------------------------------------
        if (action.action === "navigate") {
          if (action.newTab) {
            const created = await chrome.tabs.create({ url: action.url });
            if (created.id) currentTabId = created.id;
            fresh.tabId = currentTabId;
          } else {
            await chrome.tabs.update(currentTabId, { url: action.url }).catch(() => undefined);
          }
          await waitForTabLoad(currentTabId, settings.pageSettleTimeoutMs);
          currentUrl = action.url;
        } else {
          await wait(settings.waitAfterActionMs);
        }

        // 7. READ PAGE AGAIN -> next iteration
        const afterTab = await chrome.tabs.get(currentTabId).catch(() => undefined);
        if (!afterTab) {
          await stopLoop("Tab disappeared after the action.");
          break;
        }
        if ((afterTab.url ?? "") !== currentUrl) {
          currentUrl = afterTab.url ?? currentUrl;
          log("info", `Page changed to ${currentUrl}; re-scanning.`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("error", `Agent loop crashed: ${message}`);
      await stopLoop(`Unexpected error: ${message}`);
    } finally {
      abortControllers.delete(controller);
      loopPromise = null;
    }
  })();

  return loopPromise;
}

function describeAction(action: AgentAction): string {
  switch (action.action) {
    case "click":
      return `click ${action.target}`;
    case "type":
      // Never log the typed value: it can be personal data.
      return `type ${action.target} (${action.value.length} chars, value withheld)`;
    case "scroll":
      return `scroll ${action.direction}`;
    case "navigate":
      return `navigate ${action.url}`;
    case "read":
      return action.target ? `read ${action.target}` : "read";
    default:
      return action.action;
  }
}

async function stopLoop(reason: string): Promise<void> {
  for (const c of abortControllers) c.abort();
  const state = await loadState();
  state.loop.running = false;
  state.loop.stoppedReason = reason;
  log("warn", `Loop stopped: ${reason}`);
  await saveState(state);
}

/** One step of the loop, driven manually from the popup. */
async function runSingleStep(mockAction?: AgentAction): Promise<PopupResponse<unknown>> {
  const settings = await loadSettings();
  const state = await loadState();
  const tab = await getActiveTab();
  if (!tab?.id) return { ok: false, error: { code: "INTERNAL_ERROR", message: "No active tab." } };

  const scanned = await scanTab(tab);
  if ("code" in scanned) return { ok: false, error: scanned };
  state.lastPage = scanned;
  await saveState(state);
  log(
    "info",
    `Scanned ${scanned.url} - ${scanned.elements.length} elements.`,
    summarize(scanned),
  );

  let action = mockAction;
  if (!action) {
    state.loop.iteration += 1;
    const next = await requestNextAction(settings, {
      sessionId: state.sessionId,
      iteration: state.loop.iteration,
      page: scanned,
    });
    if (!next.ok) {
      log("error", next.error.message, next.error);
      return { ok: false, error: next.error };
    }
    const validated = validateAction(next.action);
    if (!validated.ok) {
      return {
        ok: false,
        error: { code: "INVALID_ACTION", message: validated.error },
      };
    }
    action = validated.value;
  } else {
    const validated = validateAction(action);
    if (!validated.ok) {
      return {
        ok: false,
        error: { code: "INVALID_ACTION", message: validated.error },
      };
    }
    action = validated.value;
  }

  state.lastAction = action;
  log("info", `Executing ${describeAction(action)}`);
  const result = await executeInTab(tab, action);
  state.lastResult = result;
  await saveState(state);
  if (result.ok) {
    log("success", `Action ${action.action} succeeded.`, result.data);
  } else {
    log("error", `Action failed [${result.error.code}]: ${result.error.message}`);
  }

  if (action.action === "navigate" && tab.id) {
    await waitForTabLoad(tab.id, settings.pageSettleTimeoutMs);
  } else {
    await wait(settings.waitAfterActionMs);
  }

  // Re-read so the caller sees the post-action state.
  const afterTab = tab.id ? await chrome.tabs.get(tab.id).catch(() => undefined) : undefined;
  let after: PageContext | undefined;
  if (afterTab) {
    const rescan = await scanTab(afterTab);
    if (!("code" in rescan)) {
      after = rescan;
      state.lastPage = rescan;
      await saveState(state);
    }
  }

  return { ok: result.ok, data: { result, page: after ?? scanned } };
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    request: PopupRequest | { id?: string; type: "CHECK_HEALTH" },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: PopupResponse | { ok: boolean; detail: string }) => void,
  ): boolean => {
    void (async () => {
      try {
        switch (request.type) {
          case "CHECK_HEALTH": {
            // The popup reads { ok, detail } directly, so do not wrap it.
            sendResponse(await checkHealth(await loadSettings()));
            return;
          }
          case "GET_SNAPSHOT": {
            sendResponse({ ok: true, data: await buildSnapshot() });
            return;
          }
          case "SCAN_ACTIVE_TAB": {
            const tab = await getActiveTab();
            if (!tab) {
              sendResponse({
                ok: false,
                error: { code: "INTERNAL_ERROR", message: "No active tab." },
              });
              return;
            }
            const scanned = await scanTab(tab);
            if ("code" in scanned) {
              sendResponse({ ok: false, error: scanned });
              return;
            }
            const state = await loadState();
            state.lastPage = scanned;
            state.tabId = tab.id;
            await saveState(state);
            log("info", `Manual scan of ${scanned.url}`, summarize(scanned));
            sendResponse({
              ok: true,
              data: { page: scanned, summary: summarize(scanned) },
            });
            return;
          }
          case "RUN_MOCK_ACTION": {
            sendResponse(await runSingleStep(request.action));
            return;
          }
          case "SAVE_SETTINGS": {
            const current = await loadSettings();
            const merged = validateSettings({ ...current, ...request.settings });
            if (!merged.ok) {
              sendResponse({
                ok: false,
                error: { code: "INVALID_ACTION", message: merged.error },
              });
              return;
            }
            await chrome.storage.local.set({ [SETTINGS_KEY]: merged.value });
            log("info", "Settings updated.", merged.value);
            sendResponse({ ok: true, data: merged.value });
            return;
          }
          case "START_LOOP": {
            // Fire and forget: the popup polls GET_SNAPSHOT for progress.
            void runAgentLoop();
            const state = await loadState();
            state.loop.running = true;
            await saveState(state);
            sendResponse({ ok: true, data: state.loop });
            return;
          }
          case "STOP_LOOP": {
            await stopLoop("Stopped by user.");
            sendResponse({ ok: true, data: (await loadState()).loop });
            return;
          }
          case "CLEAR_LOGS": {
            const state = await loadState();
            state.logs = [];
            await saveState(state);
            sendResponse({ ok: true, data: true });
            return;
          }
          default: {
            const exhaustive: never = request;
            sendResponse({
              ok: false,
              error: {
                code: "INVALID_ACTION",
                message: `Unknown request: ${JSON.stringify(exhaustive)}`,
              },
            });
            return;
          }
        }
      } catch (err) {
        sendResponse({
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "Background error.",
            detail: err instanceof Error ? err.message : String(err),
          },
        });
      }
    })();
    return true; // keep the channel open for the async response
  },
);

// A worker restart must not leave a phantom "running" flag behind.
chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    const state = await loadState();
    if (state.loop.running) {
      state.loop.running = false;
      state.loop.stoppedReason = "Service worker restarted.";
      await saveState(state);
    }
  })();
});
