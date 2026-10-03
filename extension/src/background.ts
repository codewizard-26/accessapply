/**
 * background.ts - MV3 service worker: message hub + agent loop.
 *
 * MV3 service workers are killed aggressively, so NOTHING durable lives in a
 * module-level global. State lives in chrome.storage.session (falls back to
 * local semantics via the same API) and is rehydrated lazily on every event.
 *
 * Real AccessApply Multi-Turn Loop:
 *   TURN 1:
 *     READ -> POST /api/agent/tasks { command, pageContext } -> RECEIVE ACTION
 *   TURN 2..N:
 *     EXECUTE -> WAIT -> RESCAN -> POST /continue { pageContext } -> RECEIVE ACTION
 *   ON ASK_USER:
 *     PAUSE -> waiting_for_user -> USER ANSWERS -> POST /respond { answer } -> RESUME
 *   ON DONE:
 *     COMPLETE
 */

import {
  checkHealth,
  createAgentTask,
  continueAgentTask,
  respondToAgentTask,
  getAuthStatus,
  loginUser,
  registerUser,
  logoutUser,
  getUserProfile,
  saveUserProfile,
  type AuthUser,
  type TaskActionResponse,
} from "./backend.js";
import {
  buildSafeRecoveryAction,
  createActionFailureKey,
} from "./actions.js";
import { validateSettings, DEFAULT_SETTINGS } from "./validate.js";
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
  JobSummaryItem,
  OverlayState,
  PageContext,
  PageSummary,
  PendingConfirmation,
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
  taskId?: string;
  command?: string;
  pendingQuestion?: string;
  discoveredJobs?: JobSummaryItem[];
  selectedJob?: JobSummaryItem;
  pendingConfirmation?: PendingConfirmation;
  userProfile?: Record<string, unknown>;
  auth?: {
    authenticated: boolean;
    user?: AuthUser;
  };
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
      status: "running",
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
      message: "This page does not allow the extension to run (special browser pages are blocked).",
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

async function updateTabOverlay(tabId: number | undefined, state: OverlayState): Promise<void> {
  if (!tabId) return;
  try {
    await sendToTab(tabId, {
      type: "UPDATE_OVERLAY",
      state,
    });
  } catch {
    /* ignore if tab is not active or content script not ready */
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait for the tab to finish loading after a navigation. */
async function waitForTabLoad(tabId: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  await wait(300);
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") {
        await wait(200);
        return;
      }
    } catch {
      return;
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

export function extractDiscoveredJobs(page: PageContext): JobSummaryItem[] {
  const jobs: JobSummaryItem[] = [];
  const seen = new Set<string>();

  // 1. Scan page elements for links or buttons related to viewing jobs
  for (const el of page.elements) {
    const acc = (el.accessibleName || "").trim();
    const txt = (el.text || "").trim();
    const href = (el.href || "").trim();
    const elId = el.id || "";

    // Pattern A: "View Job details for [Title] at [Company]" (used by demo job portal & standard portals)
    const viewMatch =
      acc.match(/view\s+job\s+(?:details\s+)?for\s+(.*?)\s+at\s+(.*)/i) ||
      txt.match(/view\s+job\s+(?:details\s+)?for\s+(.*?)\s+at\s+(.*)/i);
    if (viewMatch && viewMatch[1] && viewMatch[2]) {
      const title = viewMatch[1].trim();
      const company = viewMatch[2].trim();
      const key = `${title.toLowerCase()}|${company.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        const meta = extractJobMetaFromText(page.text, title, company);
        jobs.push({
          id: `job_${jobs.length + 1}`,
          title,
          company,
          location: meta.location || "Remote",
          salary: meta.salary,
          employmentType: meta.employmentType,
          targetId: elId,
          url: href || undefined,
        });
      }
      continue;
    }

    // Pattern B: Link to /jobs/:id or /job/:id
    const jobUrlMatch = href.match(/\/jobs?\/([a-zA-Z0-9_-]+)/i);
    if (jobUrlMatch && (el.type === "link" || el.role === "link" || el.type === "button")) {
      const title = txt || acc;
      if (
        title &&
        !/view\s*job|apply|details|read\s*more|back|jobs|home/i.test(title) &&
        title.length < 80
      ) {
        const key = title.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          const meta = extractJobMetaFromText(page.text, title);
          jobs.push({
            id: `job_${jobs.length + 1}`,
            title,
            company: meta.company,
            location: meta.location || "Remote",
            salary: meta.salary,
            employmentType: meta.employmentType,
            targetId: elId,
            url: href,
          });
        }
      }
    }
  }

  // 2. Pattern C: Fallback to structured text analysis if elements didn't yield multiple jobs
  if (jobs.length < 2 && page.text) {
    const textJobs = parseJobsFromText(page.text);
    for (const tj of textJobs) {
      if (!tj.title) continue;
      const key = `${tj.title.toLowerCase()}|${(tj.company || "").toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        const matchEl = page.elements.find(
          (e) =>
            (e.text && e.text.includes(tj.title!)) ||
            (e.accessibleName && e.accessibleName.includes(tj.title!)) ||
            (e.id && e.id.toLowerCase().includes(`view-job-${jobs.length + 1}`)) ||
            (e.id && e.id.toLowerCase().includes(`job-card-${jobs.length + 1}`)),
        );
        jobs.push({
          id: `job_${jobs.length + 1}`,
          title: tj.title,
          company: tj.company,
          location: tj.location || "Remote",
          salary: tj.salary,
          targetId: matchEl?.id,
        });
      }
    }
  }

  return jobs;
}

function parseJobsFromText(text: string): Partial<JobSummaryItem>[] {
  const results: Partial<JobSummaryItem>[] = [];
  const titleKeywords = /(software engineer|frontend developer|backend engineer|full stack|product designer|qa engineer|data engineer|devops engineer)/i;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const match = line.match(titleKeywords);
    if (match) {
      const title = line.replace(/^\d+[\.\)]\s*/, "").trim();
      const line1 = lines[i + 1];
      const company =
        line1 && !line1.match(titleKeywords) && line1.length < 50
          ? line1
          : undefined;
      const line2 = lines[i + 2];
      const location =
        line2 &&
        /remote|bangalore|mumbai|pune|delhi|hyderabad|onsite|hybrid/i.test(line2)
          ? line2
          : "Remote";
      const lineIdx = text.indexOf(line);
      const salaryMatch =
        lineIdx !== -1
          ? text.slice(lineIdx, lineIdx + 300).match(/(?:[₹$€£]\s?[\d\w–\-\s]+LPA|[\d,]+\s?k)/i)
          : null;
      results.push({
        title,
        company,
        location,
        salary: salaryMatch ? salaryMatch[0].trim() : undefined,
      });
      if (results.length >= 6) break;
    }
  }
  return results;
}

function extractJobMetaFromText(
  text: string,
  title: string,
  company?: string,
): { location?: string; salary?: string; employmentType?: string; company?: string } {
  const meta: { location?: string; salary?: string; employmentType?: string; company?: string } = {};
  if (!text) return meta;

  const idx = text.toLowerCase().indexOf(title.toLowerCase());
  const scope = idx !== -1 ? text.slice(idx, idx + 400) : text;

  const sal = scope.match(/(?:[₹$€£]\s?[\d\w–\-\s]+LPA|[\d,]+\s?k(?:\/yr)?)/i);
  if (sal) meta.salary = sal[0].trim();

  const loc = scope.match(
    /(?:Bangalore\s*\/\s*Remote|Mumbai\s*\/\s*Remote|Pune\s*\/\s*Remote|Remote|Bangalore|Mumbai|Pune|Delhi|Hybrid|On-site)/i,
  );
  if (loc) meta.location = loc[0].trim();

  const emp = scope.match(/(?:Full-time|Part-time|Contract|Internship)/i);
  if (emp) meta.employmentType = emp[0].trim();

  if (!company) {
    const compMatch = scope.match(/(?:TechNova|CloudWorks|DataStack|PixelLabs|QualityHub)/i);
    if (compMatch) meta.company = compMatch[0].trim();
  } else {
    meta.company = company;
  }

  return meta;
}

async function buildSnapshot(): Promise<RuntimeSnapshot> {
  const [state, settings, tab] = await Promise.all([
    loadState(),
    loadSettings(),
    getActiveTab(),
  ]);
  const contentScriptReady = tab?.id ? await ensureContentScript(tab) : false;
  
  // Ensure profile is available in snapshot
  const profileStored = await chrome.storage.local.get("accessapply.profile");
  const userProfile = state.userProfile || (profileStored["accessapply.profile"] as Record<string, unknown> | undefined);

  return {
    settings,
    loop: {
      ...state.loop,
      discoveredJobs: state.discoveredJobs || state.loop.discoveredJobs,
      selectedJob: state.selectedJob || state.loop.selectedJob,
      pendingConfirmation: state.pendingConfirmation || state.loop.pendingConfirmation,
    },
    lastPage: state.lastPage,
    logs: state.logs.slice(-80),
    contentScriptReady,
    tabId: tab?.id,
    tabUrl: tab?.url,
    auth: state.auth,
    profile: userProfile,
  };
}

// ---------------------------------------------------------------------------
// The Agent Loop
// ---------------------------------------------------------------------------

function resetLoopState(state: PersistedState, settings: ExtensionSettings): void {
  state.loop = {
    running: true,
    iteration: 0,
    maxIterations: settings.maxIterations,
    startedAt: Date.now(),
    consecutiveFailures: 0,
    status: "running",
    taskId: state.taskId,
    command: state.command,
    pendingQuestion: state.pendingQuestion,
  };
  state.logs = [];
  state.seq = 0;
  state.sessionId = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function runAgentLoop(customCommand?: string): Promise<void> {
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
      await stopLoop("No active browser tab found.");
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
          log("warn", "Loop stopped.");
          break;
        }
        if (fresh.loop.iteration >= fresh.loop.maxIterations) {
          await stopLoop(`Reached iteration limit (${fresh.loop.maxIterations}).`);
          break;
        }

        fresh.loop.iteration += 1;
        const iteration = fresh.loop.iteration;
        log("info", `Iteration ${iteration}: scanning page...`);

        // 1. READ
        let activeTab = await chrome.tabs.get(currentTabId).catch(() => undefined);
        if (!activeTab) {
          await stopLoop("Active tab was closed.");
          break;
        }
        const scanned = await scanTab(activeTab);
        if ("code" in scanned) {
          if (scanned.code === "UNSUPPORTED_TARGET") {
            await stopLoop(
              "AccessApply can't interact with this browser page. Open a normal webpage to continue.",
            );
            break;
          }
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

        // Immediate Real Success Detection (Requirement 20, 24)
        const isSuccessPage =
          page.url.includes("/success") ||
          page.url.includes("/submitted") ||
          /application\s+(?:submitted|received|successful)/i.test(page.text) ||
          /thank\s+you\s+for\s+applying/i.test(page.text);

        if (isSuccessPage) {
          log("success", "Application submitted successfully! Detected confirmed success state on page.");
          fresh.loop.running = false;
          fresh.loop.status = "completed";
          fresh.loop.stoppedReason = "Application submitted successfully!";
          fresh.pendingQuestion = undefined;
          fresh.loop.pendingQuestion = undefined;
          await saveState(fresh);
          await updateTabOverlay(activeTab.id, {
            visible: true,
            completed: true,
            statusText: "Application submitted successfully!",
          });
          break;
        }

        // Discovery Mode Check: If multiple jobs are found and no job selected yet, stop and present list
        const discovered = extractDiscoveredJobs(page);
        if (discovered.length > 0 && !fresh.selectedJob) {
          fresh.discoveredJobs = discovered;
          fresh.loop.discoveredJobs = discovered;
          fresh.loop.running = false;
          fresh.loop.status = "waiting_for_user";
          fresh.loop.stoppedReason = `Found ${discovered.length} jobs. Select a job to view details.`;
          await saveState(fresh);
          log("info", `Discovery Mode: found ${discovered.length} jobs. Waiting for user choice.`);
          await updateTabOverlay(activeTab.id, {
            visible: true,
            statusText: `${discovered.length} jobs found. Which job would you like?`,
            discoveredJobs: discovered,
            voiceStatus: "ready",
          });
          break;
        }

        // Fetch UserProfile to provide to backend task
        const profileStored = await chrome.storage.local.get("accessapply.profile");
        const currentProfile = (fresh.userProfile || profileStored["accessapply.profile"]) as Record<string, unknown> | undefined;

        // 2. SEND TO BACKEND
        let next: TaskActionResponse;
        if (!fresh.taskId) {
          const commandToRun =
            customCommand ||
            fresh.command ||
            "Find a remote software engineering job and apply to it.";
          fresh.command = commandToRun;
          fresh.loop.command = commandToRun;
          log("info", `Starting task: "${commandToRun}"`);
          next = await createAgentTask(settings, commandToRun, page, currentProfile, controller.signal);
          if (next.ok) {
            fresh.taskId = next.task.id;
            fresh.loop.taskId = next.task.id;
            fresh.loop.status = next.task.status;
          }
        } else {
          log("info", `Continuing task ${fresh.taskId}...`);
          next = await continueAgentTask(settings, fresh.taskId, page, currentProfile, controller.signal);
          if (next.ok) {
            fresh.loop.status = next.task.status;
          }
        }

        if (!next.ok) {
          log("error", `Backend error: ${next.error.message}`, next.error);
          fresh.loop.consecutiveFailures += 1;
          fresh.loop.lastError = next.error;
          if (next.error.code === "REQUIRES_AUTHORIZATION") {
            await stopLoop(next.error.message);
            break;
          }
          if (fresh.loop.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            await stopLoop(`Repeated backend failures: ${next.error.message}`);
            break;
          }
          await wait(500 * fresh.loop.consecutiveFailures);
          continue;
        }

        // 3. PROCESS AGENT ACTION
        const action = next.action;
        fresh.loop.lastAction = action;
        await saveState(fresh);
        log("info", `Agent Action: ${describeAction(action)}`);

        if (action.action === "done") {
          log("success", "Application completed successfully!");
          fresh.loop.running = false;
          fresh.loop.status = "completed";
          fresh.loop.stoppedReason = "Application process completed successfully!";
          fresh.pendingQuestion = undefined;
          fresh.loop.pendingQuestion = undefined;
          await saveState(fresh);
          await updateTabOverlay(activeTab.id, {
            visible: true,
            completed: true,
            statusText: "Application completed successfully!",
          });
          break;
        }

        if (action.action === "ask_user") {
          log("warn", `Agent asked: "${action.question}"`);
          fresh.loop.running = false;
          fresh.loop.status = "waiting_for_user";
          fresh.pendingQuestion = action.question;
          fresh.loop.pendingQuestion = action.question;
          fresh.loop.stoppedReason = `Agent asked: "${action.question}"`;
          await saveState(fresh);
          await updateTabOverlay(activeTab.id, {
            visible: true,
            statusText: action.question,
            pendingQuestion: action.question,
            voiceStatus: "listening",
          });
          break; // PAUSE THE TASK: wait for user's response in popup UI
        }

        if (shouldRecoverWithSafeRead(fresh, action)) {
          const recovery = buildSafeRecoveryAction(action);
          log(
            "warn",
            "Repeated blocked action detected; selecting safe alternative.",
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
          await wait(settings.waitAfterActionMs);
          continue;
        }

        // Check for Human Confirmation Gate on Apply
        if (action.action === "click") {
          const targetStr = (action.target || "").toLowerCase();
          const reasonStr = (action.reason || "").toLowerCase();
          const targetEl = page.elements.find((e) => e.id === action.target);
          const targetText = ((targetEl?.text || "") + " " + (targetEl?.accessibleName || "")).toLowerCase();
          const isApplyAction =
            targetStr.includes("apply") ||
            reasonStr.includes("apply") ||
            targetText.includes("apply");

          if (isApplyAction && !action.userAuthorized && !fresh.pendingConfirmation) {
            log("warn", "Application Confirmation Gate: User approval required before applying.");
            fresh.loop.running = false;
            fresh.loop.status = "waiting_for_user";
            fresh.loop.pendingConfirmation = {
              type: "apply",
              job: fresh.selectedJob,
              message: `You selected ${fresh.selectedJob?.title || "this job"}. Would you like me to apply?`,
              targetAction: { ...action, userAuthorized: true },
            };
            fresh.pendingConfirmation = fresh.loop.pendingConfirmation;
            fresh.loop.stoppedReason = "Waiting for your confirmation to apply.";
            await saveState(fresh);
            await updateTabOverlay(activeTab.id, {
              visible: true,
              statusText: "Confirmation required to apply",
              pendingConfirmation: fresh.loop.pendingConfirmation,
              voiceStatus: "ready",
            });
            break;
          }

          // Check for Human Confirmation Gate on Submit
          const isSubmitAction =
            targetStr.includes("submit") ||
            reasonStr.includes("submit") ||
            targetText.includes("submit");

          if (
            isSubmitAction &&
            settings.assistanceLevel !== "act" &&
            !action.userAuthorized &&
            !fresh.pendingConfirmation
          ) {
            log("warn", "Submission Confirmation Gate: User approval required before submitting.");
            fresh.loop.running = false;
            fresh.loop.status = "waiting_for_user";
            fresh.loop.pendingConfirmation = {
              type: "submit",
              job: fresh.selectedJob,
              message: "Application form is complete. Would you like me to submit?",
              targetAction: { ...action, userAuthorized: true },
            };
            fresh.pendingConfirmation = fresh.loop.pendingConfirmation;
            fresh.loop.stoppedReason = "Waiting for your confirmation before submitting application.";
            await saveState(fresh);
            await updateTabOverlay(activeTab.id, {
              visible: true,
              statusText: "Application complete. Confirm to submit.",
              pendingConfirmation: fresh.loop.pendingConfirmation,
              voiceStatus: "ready",
            });
            break;
          }
        }

        // Pre-type Redundancy Check (Requirements 14, 15, 21)
        if (action.action === "type") {
          const targetEl = page.elements.find((e) => e.id === action.target);
          const currentVal = (targetEl?.value || "").trim().toLowerCase();
          const desiredVal = (action.value || "").trim().toLowerCase();
          if (
            currentVal &&
            (currentVal === desiredVal ||
              currentVal.includes(desiredVal) ||
              desiredVal.includes(currentVal))
          ) {
            log(
              "info",
              `Field '${action.target}' is already filled with '${targetEl?.value}'. Skipping redundant typing.`,
            );
            const skipResult: ActionResult = {
              ok: true,
              action: "type",
              message: `Skipped redundant type into ${action.target} (already contains "${targetEl?.value}").`,
            };
            fresh.loop.lastResult = skipResult;
            fresh.loop.consecutiveFailures = 0;
            fresh.loop.lastError = undefined;
            await saveState(fresh);
            await wait(settings.waitAfterActionMs);
            continue;
          }
        }

        // 4. EXECUTE ACTION IN TAB
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

        // 5. WAIT FOR PAGE UPDATE
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

        // 6. DETECT PAGE CHANGES
        const afterTab = await chrome.tabs.get(currentTabId).catch(() => undefined);
        if (!afterTab) {
          await stopLoop("Tab disappeared after action.");
          break;
        }
        if ((afterTab.url ?? "") !== currentUrl) {
          currentUrl = afterTab.url ?? currentUrl;
          log("info", `Page changed to ${currentUrl}; re-scanning.`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("error", `Agent loop error: ${message}`);
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
      return `type ${action.target} (${action.value.length} chars, value withheld)`;
    case "scroll":
      return `scroll ${action.direction}`;
    case "navigate":
      return `navigate ${action.url}`;
    case "read":
      return action.target ? `read ${action.target}` : "read";
    case "ask_user":
      return `ask_user: "${action.question}"`;
    case "done":
      return "done";
    default:
      return (action as AgentAction).action;
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

// ---------------------------------------------------------------------------
// Message Handling
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
            sendResponse(await checkHealth(await loadSettings()));
            return;
          }
          case "CHECK_AUTH": {
            const settings = await loadSettings();
            const auth = await getAuthStatus(settings);
            const state = await loadState();
            state.auth = auth;
            await saveState(state);
            sendResponse({ ok: true, data: auth });
            return;
          }
          case "LOGIN": {
            const settings = await loadSettings();
            const res = await loginUser(settings, request.email, request.password);
            if (res.ok) {
              const state = await loadState();
              state.auth = { authenticated: true, user: res.user };
              await saveState(state);
              log("info", `User logged in as ${res.user?.email}`);
              sendResponse({ ok: true, data: res.user });
            } else {
              sendResponse({
                ok: false,
                error: { code: "REQUIRES_AUTHORIZATION", message: res.error || "Login failed" },
              });
            }
            return;
          }
          case "REGISTER": {
            const settings = await loadSettings();
            const res = await registerUser(settings, request.email, request.password);
            if (res.ok) {
              const state = await loadState();
              state.auth = { authenticated: true, user: res.user };
              await saveState(state);
              log("info", `User registered as ${res.user?.email}`);
              sendResponse({ ok: true, data: res.user });
            } else {
              sendResponse({
                ok: false,
                error: { code: "REQUIRES_AUTHORIZATION", message: res.error || "Registration failed" },
              });
            }
            return;
          }
          case "LOGOUT": {
            const settings = await loadSettings();
            await logoutUser(settings);
            const state = await loadState();
            state.auth = { authenticated: false };
            await saveState(state);
            log("info", "User logged out.");
            sendResponse({ ok: true, data: true });
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
          case "START_TASK": {
            const cmd = request.command?.trim();
            const state = await loadState();
            state.taskId = undefined;
            state.pendingQuestion = undefined;
            state.discoveredJobs = undefined;
            state.selectedJob = undefined;
            state.pendingConfirmation = undefined;
            state.command = cmd;
            state.loop.taskId = undefined;
            state.loop.pendingQuestion = undefined;
            state.loop.discoveredJobs = undefined;
            state.loop.selectedJob = undefined;
            state.loop.pendingConfirmation = undefined;
            state.loop.status = "running";
            state.loop.running = true;
            if (request.userProfile) {
              state.userProfile = request.userProfile;
            }
            await saveState(state);
            void runAgentLoop(cmd);
            sendResponse({ ok: true, data: state.loop });
            return;
          }
          case "SELECT_JOB": {
            const state = await loadState();
            const job = request.job;
            state.selectedJob = job;
            state.loop.selectedJob = job;
            state.discoveredJobs = undefined;
            state.loop.discoveredJobs = undefined;
            log("info", `User selected job: "${job.title}" at ${job.company || "company"}`);

            const tab = await getActiveTab();
            if (tab?.id) {
              if (job.targetId) {
                log("info", `Navigating to job details via click: #${job.targetId}`);
                await executeInTab(tab, { action: "click", target: job.targetId });
              } else if (job.url) {
                log("info", `Navigating to job details via URL: ${job.url}`);
                await chrome.tabs.update(tab.id, { url: job.url });
              }
              const settings = await loadSettings();
              await waitForTabLoad(tab.id, settings.pageSettleTimeoutMs);
              const scanned = await scanTab(tab);
              if (!("code" in scanned)) {
                state.lastPage = scanned;
              }
            }

            // Trigger Application Confirmation Gate immediately upon viewing details
            state.loop.pendingConfirmation = {
              type: "apply",
              job,
              message: `You selected ${job.title} at ${job.company || "the company"}. Would you like me to apply for this job?`,
              targetAction: { action: "click", target: "apply-button" },
            };
            state.pendingConfirmation = state.loop.pendingConfirmation;
            state.loop.running = false;
            state.loop.status = "waiting_for_user";
            state.loop.stoppedReason = `You selected ${job.title} at ${job.company || "the company"}. Would you like me to apply?`;
            await saveState(state);
            if (tab?.id) {
              await updateTabOverlay(tab.id, {
                visible: true,
                statusText: state.loop.stoppedReason,
                pendingConfirmation: state.loop.pendingConfirmation,
                voiceStatus: "ready",
              });
            }
            sendResponse({ ok: true, data: state.loop });
            return;
          }
          case "CONFIRM_APPLICATION": {
            const state = await loadState();
            const pending = state.pendingConfirmation || state.loop.pendingConfirmation;
            if (!pending) {
              sendResponse({
                ok: false,
                error: { code: "INVALID_ACTION", message: "No pending confirmation." },
              });
              return;
            }

            state.pendingConfirmation = undefined;
            state.loop.pendingConfirmation = undefined;
            await saveState(state);

            const tab = await getActiveTab();
            if (tab?.id && pending.targetAction) {
              log("info", `Executing confirmed action: ${describeAction(pending.targetAction)}`);
              await updateTabOverlay(tab.id, {
                visible: true,
                statusText: "Processing confirmed application...",
                pendingConfirmation: undefined,
              });
              await executeInTab(tab, pending.targetAction);
              const settings = await loadSettings();
              await waitForTabLoad(tab.id, settings.pageSettleTimeoutMs);
            }

            // Resume agent loop to continue autofill or submission
            state.loop.running = true;
            state.loop.status = "running";
            await saveState(state);
            void runAgentLoop();
            sendResponse({ ok: true, data: state.loop });
            return;
          }
          case "CANCEL_APPLICATION": {
            const state = await loadState();
            state.pendingConfirmation = undefined;
            state.loop.pendingConfirmation = undefined;
            state.loop.running = false;
            state.loop.stoppedReason = "Application cancelled by user.";
            log("info", "User cancelled application.");
            await saveState(state);
            const tab = await getActiveTab();
            if (tab?.id) {
              await updateTabOverlay(tab.id, {
                visible: true,
                statusText: "Application cancelled by user.",
                pendingConfirmation: undefined,
              });
            }
            sendResponse({ ok: true, data: state.loop });
            return;
          }
          case "GET_PROFILE": {
            const settings = await loadSettings();
            const state = await loadState();
            const res = await getUserProfile(settings);
            if (res.ok && res.profile) {
              state.userProfile = res.profile;
              await saveState(state);
              await chrome.storage.local.set({ "accessapply.profile": res.profile });
              sendResponse({ ok: true, data: res.profile });
              return;
            }
            const stored = await chrome.storage.local.get("accessapply.profile");
            sendResponse({ ok: true, data: stored["accessapply.profile"] || {} });
            return;
          }
          case "SAVE_PROFILE": {
            const settings = await loadSettings();
            const state = await loadState();
            state.userProfile = request.profile;
            await saveState(state);
            await chrome.storage.local.set({ "accessapply.profile": request.profile });
            const res = await saveUserProfile(settings, request.profile);
            if (res.ok) {
              sendResponse({ ok: true, data: res.profile });
            } else {
              sendResponse({ ok: true, data: request.profile });
            }
            return;
          }
          case "RESPOND_TO_TASK": {
            const answer = request.answer?.trim();
            if (!answer) {
              sendResponse({
                ok: false,
                error: { code: "INVALID_ACTION", message: "Answer cannot be empty." },
              });
              return;
            }
            const state = await loadState();
            if (!state.taskId) {
              sendResponse({
                ok: false,
                error: { code: "INVALID_ACTION", message: "No active task waiting for a response." },
              });
              return;
            }
            const settings = await loadSettings();
            log("info", `Answering agent with: "${answer}"`);
            const next = await respondToAgentTask(settings, state.taskId, answer);
            if (!next.ok) {
              log("error", `Failed to send answer: ${next.error.message}`);
              sendResponse({ ok: false, error: next.error });
              return;
            }
            state.pendingQuestion = undefined;
            state.loop.pendingQuestion = undefined;
            state.loop.status = next.task.status;
            const action = next.action;
            state.loop.lastAction = action;
            await saveState(state);

            // Execute resulting action if active tab exists
            const tab = await getActiveTab();
            if (tab && action.action !== "done" && action.action !== "ask_user") {
              const result = await executeInTab(tab, action);
              state.lastResult = result;
              if (result.ok) {
                log("success", `Executed ${action.action}.`, result.data);
              }
            }

            if (action.action === "done") {
              state.loop.running = false;
              state.loop.status = "completed";
              state.loop.stoppedReason = "Application process completed successfully!";
              await saveState(state);
              if (tab?.id) {
                await updateTabOverlay(tab.id, {
                  visible: true,
                  completed: true,
                  statusText: "Application completed successfully!",
                });
              }
              sendResponse({ ok: true, data: { completed: true, action } });
              return;
            }

            if (action.action === "ask_user") {
              state.loop.running = false;
              state.loop.status = "waiting_for_user";
              state.pendingQuestion = action.question;
              state.loop.pendingQuestion = action.question;
              state.loop.stoppedReason = `Agent asked: "${action.question}"`;
              await saveState(state);
              if (tab?.id) {
                await updateTabOverlay(tab.id, {
                  visible: true,
                  statusText: action.question,
                  pendingQuestion: action.question,
                  voiceStatus: "listening",
                });
              }
              sendResponse({ ok: true, data: { waiting: true, question: action.question } });
              return;
            }

            // Resume loop
            state.loop.running = true;
            await saveState(state);
            void runAgentLoop();
            sendResponse({ ok: true, data: { action } });
            return;
          }
          case "RUN_MOCK_ACTION": {
            const tab = await getActiveTab();
            if (!tab?.id) {
              sendResponse({ ok: false, error: { code: "INTERNAL_ERROR", message: "No active tab." } });
              return;
            }
            const result = await executeInTab(tab, request.action);
            sendResponse({ ok: result.ok, data: { result } });
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
    return true;
  },
);

// Worker restart must not leave a phantom "running" flag behind.
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
