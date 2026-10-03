/**
 * popup.ts - test harness UI.
 *
 * Talks only to the service worker via typed messages. It holds no logic of
 * its own: every button maps to a `PopupRequest`.
 */

import { MOCK_SCENARIOS } from "../backend.js";
import type {
  AgentAction,
  ExtensionSettings,
  PageContext,
  PopupRequest,
  PopupResponse,
  RuntimeSnapshot,
} from "../types.js";

/** Distributes over the union so each variant keeps its own required fields. */
type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : T;

/** True once the user edits a settings field, so polling stops clobbering it. */
let settingsTouched = false;

let requestCounter = 0;
function send<T = unknown>(
  req: WithoutId<PopupRequest>,
): Promise<PopupResponse<T>> {
  const message = { id: `r${++requestCounter}`, ...req } as PopupRequest;
  return chrome.runtime.sendMessage(message) as Promise<PopupResponse<T>>;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

const dom = {
  pageTitle: el<HTMLParagraphElement>("page-title"),
  tabUrl: el<HTMLParagraphElement>("tab-url"),
  elementCount: el("element-count"),
  jobTitle: el("job-title"),
  health: el("health"),
  backendUrl: el<HTMLInputElement>("backend-url"),
  nextActionPath: el<HTMLInputElement>("next-action-path"),
  healthPath: el<HTMLInputElement>("health-path"),
  mockMode: el<HTMLInputElement>("mock-mode"),
  mockScenario: el<HTMLSelectElement>("mock-scenario"),
  maxIterations: el<HTMLInputElement>("max-iterations"),
  consequential: el<HTMLInputElement>("consequential"),
  fontSize: el<HTMLSelectElement>("font-size"),
  highContrast: el<HTMLInputElement>("high-contrast"),
  reducedMotion: el<HTMLInputElement>("reduced-motion"),
  speechSynthesis: el<HTMLInputElement>("speech-synthesis"),
  voiceCommands: el<HTMLInputElement>("voice-commands"),
  screenReaderMode: el<HTMLInputElement>("screen-reader-mode"),
  plainLanguage: el<HTMLInputElement>("plain-language"),
  autoSpeak: el<HTMLInputElement>("auto-speak"),
  btnScan: el<HTMLButtonElement>("btn-scan"),
  btnStart: el<HTMLButtonElement>("btn-start"),
  btnStop: el<HTMLButtonElement>("btn-stop"),
  btnClear: el<HTMLButtonElement>("btn-clear"),
  btnMockClick: el<HTMLButtonElement>("btn-mock-click"),
  btnMockType: el<HTMLButtonElement>("btn-mock-type"),
  btnMockScroll: el<HTMLButtonElement>("btn-mock-scroll"),
  btnMockRead: el<HTMLButtonElement>("btn-mock-read"),
  btnMockInvalid: el<HTMLButtonElement>("btn-mock-invalid"),
  loopStatus: el<HTMLParagraphElement>("loop-status"),
  log: el<HTMLOListElement>("log"),
};

for (const scenario of MOCK_SCENARIOS) {
  const option = document.createElement("option");
  option.value = scenario;
  option.textContent = scenario;
  dom.mockScenario.append(option);
}

function applyAccessibilityStyles(settings: ExtensionSettings): void {
  document.body.dataset["fontSize"] = settings.fontSize;
  document.body.classList.toggle("high-contrast", settings.highContrast);
  document.body.classList.toggle("reduced-motion", settings.reducedMotion);
}

function fillSettings(settings: ExtensionSettings): void {
  dom.backendUrl.value = settings.backendUrl;
  dom.nextActionPath.value = settings.nextActionPath;
  dom.healthPath.value = settings.healthPath;
  dom.mockMode.checked = settings.mockMode;
  dom.mockScenario.value = settings.mockScenario;
  dom.maxIterations.value = String(settings.maxIterations);
  dom.consequential.checked = settings.allowConsequentialActions;
  dom.fontSize.value = settings.fontSize;
  dom.highContrast.checked = settings.highContrast;
  dom.reducedMotion.checked = settings.reducedMotion;
  dom.speechSynthesis.checked = settings.speechSynthesisEnabled;
  dom.voiceCommands.checked = settings.voiceCommandsEnabled;
  dom.screenReaderMode.checked = settings.screenReaderMode;
  dom.plainLanguage.checked = settings.plainLanguageMode;
  dom.autoSpeak.checked = settings.autoSpeakSummaries;
  applyAccessibilityStyles(settings);
}

function collectSettings(): Partial<ExtensionSettings> {
  return {
    backendUrl: dom.backendUrl.value.trim(),
    nextActionPath: dom.nextActionPath.value.trim() || "/api/agent/next-action",
    healthPath: dom.healthPath.value.trim() || "/api/health",
    mockMode: dom.mockMode.checked,
    mockScenario: dom.mockScenario.value,
    maxIterations: Number(dom.maxIterations.value) || 10,
    allowConsequentialActions: dom.consequential.checked,
    fontSize: dom.fontSize.value as ExtensionSettings["fontSize"],
    highContrast: dom.highContrast.checked,
    reducedMotion: dom.reducedMotion.checked,
    speechSynthesisEnabled: dom.speechSynthesis.checked,
    voiceCommandsEnabled: dom.voiceCommands.checked,
    screenReaderMode: dom.screenReaderMode.checked,
    plainLanguageMode: dom.plainLanguage.checked,
    autoSpeakSummaries: dom.autoSpeak.checked,
  };
}

function renderSummary(page: PageContext): void {
  dom.pageTitle.textContent = page.title || "(untitled page)";
  dom.tabUrl.textContent = page.url;
  dom.elementCount.textContent = String(page.elements.length);
  const job = page.job;
  dom.jobTitle.textContent = job?.title
    ? [job.title, job.company, job.location, job.employmentType, job.workMode]
        .filter(Boolean)
        .join(" - ")
    : "not detected";
}

function renderLogs(snapshot: RuntimeSnapshot): void {
  dom.log.replaceChildren();
  for (const entry of snapshot.logs.slice(-60)) {
    const li = document.createElement("li");
    li.className = `level-${entry.level}`;

    const ts = document.createElement("span");
    ts.className = "ts";
    ts.textContent = new Date(entry.ts).toLocaleTimeString();
    li.append(ts, document.createTextNode(entry.message));
    dom.log.append(li);
  }
  dom.log.scrollTop = dom.log.scrollHeight;
}

function renderLoop(snapshot: RuntimeSnapshot): void {
  const { loop, contentScriptReady } = snapshot;
  dom.btnStop.disabled = !loop.running;
  dom.btnStart.disabled = loop.running;
  if (loop.running) {
    dom.loopStatus.textContent = `Running - iteration ${loop.iteration} of ${loop.maxIterations}.`;
  } else if (loop.stoppedReason) {
    dom.loopStatus.textContent = `Idle - ${loop.stoppedReason}`;
  } else {
    dom.loopStatus.textContent = contentScriptReady
      ? "Idle - ready."
      : "Idle - content script unavailable on this page.";
  }
}

async function refresh(): Promise<RuntimeSnapshot | undefined> {
  const response = await send<RuntimeSnapshot>({ type: "GET_SNAPSHOT" });
  if (!response.ok || !response.data) {
    dom.loopStatus.textContent =
      response.error?.message ?? "Could not reach the service worker.";
    return undefined;
  }
  const snapshot = response.data;
  if (!settingsTouched) fillSettings(snapshot.settings);
  if (snapshot.lastPage) renderSummary(snapshot.lastPage);
  renderLoop(snapshot);
  renderLogs(snapshot);
  return snapshot;
}

async function withBusy<T>(fn: () => Promise<T>): Promise<T | undefined> {
  document
    .querySelectorAll("button")
    .forEach((b) => ((b as HTMLButtonElement).disabled = true));
  try {
    return await fn();
  } finally {
    await refresh();
  }
}

dom.backendUrl.addEventListener("input", () => {
  settingsTouched = true;
});

for (const input of [
  dom.nextActionPath,
  dom.healthPath,
  dom.mockMode,
  dom.mockScenario,
  dom.maxIterations,
  dom.consequential,
  dom.fontSize,
  dom.highContrast,
  dom.reducedMotion,
  dom.speechSynthesis,
  dom.voiceCommands,
  dom.screenReaderMode,
  dom.plainLanguage,
  dom.autoSpeak,
]) {
  input.addEventListener("change", async () => {
    const response = await send<ExtensionSettings>({
      type: "SAVE_SETTINGS",
      settings: collectSettings(),
    });
    if (!response.ok) {
      dom.health.textContent =
        response.error?.message ?? "Could not save settings.";
      return;
    }
    applyAccessibilityStyles(response.data ?? collectSettings() as ExtensionSettings);
    await refresh();
    await checkHealth();
  });
}

dom.btnScan.addEventListener(
  "click",
  () =>
    void withBusy(async () => {
      const response = await send<{ page: PageContext }>({
        type: "SCAN_ACTIVE_TAB",
      });
      if (!response.ok || !response.data) {
        dom.pageTitle.textContent = response.error?.message ?? "Scan failed.";
        return;
      }
      renderSummary(response.data.page);
    }),
);

dom.btnStart.addEventListener(
  "click",
  () => void withBusy(() => send({ type: "START_LOOP" })),
);
dom.btnStop.addEventListener(
  "click",
  () => void withBusy(() => send({ type: "STOP_LOOP" })),
);
dom.btnClear.addEventListener(
  "click",
  () => void withBusy(() => send({ type: "CLEAR_LOGS" })),
);

const mockButtons: Array<[HTMLButtonElement, () => AgentAction]> = [
  [dom.btnMockClick, () => ({ action: "click", target: "el_1" })],
  [
    dom.btnMockType,
    () => ({ action: "type", target: "el_1", value: "Test User" }),
  ],
  [dom.btnMockScroll, () => ({ action: "scroll", direction: "down" })],
  [dom.btnMockRead, () => ({ action: "read" })],
  // Deliberately invalid: proves errors are reported, not thrown.
  [
    dom.btnMockInvalid,
    () => ({ action: "navigate", url: "javascript:alert(1)" }) as AgentAction,
  ],
];

for (const [button, makeAction] of mockButtons) {
  button.addEventListener(
    "click",
    () =>
      void withBusy(async () => {
        const response = await send<{
          result: { ok: boolean; error?: { message: string } };
        }>({
          type: "RUN_MOCK_ACTION",
          action: makeAction(),
        });
        if (!response.ok) {
          dom.loopStatus.textContent =
            response.error?.message ?? "Action failed.";
          return;
        }
        const result = response.data?.result;
        dom.loopStatus.textContent = result?.ok
          ? "Mock action succeeded."
          : `Mock action failed: ${result?.error?.message ?? "unknown error"}`;
      }),
  );
}

async function checkHealth(): Promise<void> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "CHECK_HEALTH",
    })) as { ok: boolean; detail: string } | undefined;
    dom.health.textContent = response
      ? `${response.ok ? "reachable" : "unreachable"} (${response.detail})`
      : "-";
  } catch {
    dom.health.textContent = "-";
  }
}

let poll: number | undefined;
function schedulePoll(): void {
  if (poll !== undefined) clearInterval(poll);
  poll = window.setInterval(() => void refresh(), 1000);
}

void (async () => {
  await refresh();
  await checkHealth();
  schedulePoll();
})();
