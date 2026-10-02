/**
 * verify-extension.mjs - loads the REAL unpacked extension from dist/ into the
 * installed Chrome and drives it through Chrome's own messaging, so the shipped
 * content script and MV3 service worker are exercised end to end.
 *
 * Flow:
 *   load dist/ unpacked -> serve test-page over http -> let the manifest inject
 *   content.js -> run the agent loop step with a mock action -> re-read the page
 *   -> confirm structured errors are returned instead of thrown.
 *
 * Run with: npm run test:extension   (requires `npm run build` first)
 * Exits 0 with a [skip] note when Chrome or playwright-core is unavailable.
 */
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

const CANDIDATE_CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);

function findChrome() {
  for (const candidate of CANDIDATE_CHROME) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Branded Chrome 137+ refuses `--load-extension` under automation, so prefer
 * Playwright's own Chromium build (`npx playwright install chromium`), which
 * still loads unpacked extensions on every version.
 */
function resolveBrowser() {
  try {
    const bundled = chromium.executablePath();
    if (bundled && existsSync(bundled)) return bundled;
  } catch {
    /* Playwright's Chromium is not installed - fall through. */
  }
  return findChrome();
}

const executablePath = resolveBrowser();
if (!executablePath) {
  console.log(
    "[skip] No Chromium found. Run `npx playwright install chromium` or set CHROME_PATH.",
  );
  process.exit(0);
}

if (!existsSync(path.join(dist, "manifest.json"))) {
  console.log("[skip] dist/ is missing - run `npm run build` first.");
  process.exit(0);
}

const checks = [];
function check(name, condition, detail) {
  checks.push({ name, ok: !!condition, detail });
}

// ---- serve the test page over http so the manifest's content_scripts match ---
const html = await readFile(path.join(root, "test-page", "index.html"));
const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const pageUrl = `http://127.0.0.1:${port}/index.html`;

const launchedDirs = [];

// ---- launch Chrome with the real unpacked extension ------------------------
/** Launch Chrome with the unpacked extension; return the MV3 worker if any. */
async function launchWithWorker(headless) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "accessapply-ext-"));
  launchedDirs.push(userDataDir);
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless,
    // Playwright disables extensions by default; that must be lifted for
    // --load-extension to have any effect.
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  let worker = ctx.serviceWorkers()[0];
  if (!worker) {
    worker = await ctx
      .waitForEvent("serviceworker", { timeout: 15000 })
      .catch(() => null);
  }
  return { ctx, worker };
}

async function cleanup() {
  await context.close().catch(() => {});
  server.close();
  for (const dir of launchedDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Extensions need Chrome's "new" headless mode, and some builds still refuse to
// start the MV3 worker there, so retry with a real window before giving up.
let { ctx: context, worker: serviceWorker } = await launchWithWorker(true);
if (!serviceWorker) {
  await context.close().catch(() => {});
  ({ ctx: context, worker: serviceWorker } = await launchWithWorker(false));
}

if (!serviceWorker) {
  console.log(
    "[skip] Could not start the MV3 service worker in this browser build.",
  );
  await cleanup();
  process.exit(0);
}

const extensionId = new URL(serviceWorker.url()).host;
check("extension loaded and service worker started", !!extensionId, extensionId);

// The popup page doubles as our drive surface: it is an extension page, so it
// can use chrome.tabs / chrome.runtime exactly like the real popup does.
const driver = await context.newPage();
await driver.goto(`chrome-extension://${extensionId}/popup.html`);

// Create the job page from the driver so it shares the window and is active.
const testTabId = await driver.evaluate(
  async (url) => (await chrome.tabs.create({ url, active: true })).id,
  pageUrl,
);
check("test page tab created", typeof testTabId === "number", String(testTabId));

// The manifest-injected content script must answer without manual injection.
let probe = null;
for (let attempt = 0; attempt < 40; attempt += 1) {
  probe = await driver.evaluate(async (tabId) => {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: "GET_STATE" });
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }, testTabId);
  if (probe?.ok) break;
  await new Promise((r) => setTimeout(r, 250));
}
check(
  "content script auto-injected by the manifest",
  probe?.ok === true,
  JSON.stringify(probe),
);

// ---- the shipped content script must scan the page ------------------------
const scan = await driver.evaluate(async (tabId) => {
  const response = await chrome.tabs.sendMessage(tabId, { type: "SCAN_PAGE" });
  if (!response?.ok) return { error: response?.error };
  const page = response.page;
  return {
    url: page.url,
    title: page.title,
    count: page.elements.length,
    job: page.job ?? null,
    details: page.elements.find(
      (e) => e.accessibleName === "Show more details",
    )?.id,
    leaksHidden: /INTERNAL_SECRET_TOKEN|ANOTHER_HIDDEN_TOKEN/.test(page.text),
    passwordLeaked: page.elements.some(
      (e) => e.inputType === "password" && e.value !== undefined,
    ),
  };
}, testTabId);

check("scan via real content script", !scan.error, JSON.stringify(scan.error));
check("scan: title", scan.title?.includes("Frontend Developer"), scan.title);
check("scan: element count", scan.count > 10, String(scan.count));
check("scan: job work mode", scan.job?.workMode === "remote", scan.job?.workMode);
check("scan: hidden content not leaked", scan.leaksHidden === false);
check("scan: password value not leaked", scan.passwordLeaked === false);
check("scan: details button resolved", !!scan.details, String(scan.details));
const scans = await (async () => {
  // ---- a mock action must run through the background worker --------------
  const clickRun = await driver.evaluate(
    async ({ tabId, target }) => {
      await chrome.tabs.update(tabId, { active: true });
      return await chrome.runtime.sendMessage({
        type: "RUN_MOCK_ACTION",
        action: { action: "click", target },
      });
    },
    { tabId: testTabId, target: scan.details },
  );
  check(
    "mock click executed via background + content script",
    clickRun?.data?.result?.ok === true,
    JSON.stringify(clickRun),
  );

  // ---- re-read the page and observe the change --------------------------
  return driver.evaluate(async (tabId) => {
    const response = await chrome.tabs.sendMessage(tabId, { type: "SCAN_PAGE" });
    const status = response?.page?.elements?.find((e) => e.role === "status");
    return { statusText: status?.text ?? null, count: response?.page?.elements?.length ?? 0 };
  }, testTabId);
})();

check(
  "re-read shows the page updated after the action",
  scans.statusText === "Details expanded.",
  JSON.stringify(scans),
);

// ---- failures must be structured, never thrown ---------------------------
const badTarget = await driver.evaluate(async (tabId) => {
  await chrome.tabs.update(tabId, { active: true });
  return await chrome.runtime.sendMessage({
    type: "RUN_MOCK_ACTION",
    action: { action: "click", target: "el_99999" },
  });
}, testTabId);
check(
  "unknown target reported as a structured failure",
  badTarget?.data?.result?.error?.code === "INVALID_TARGET",
  JSON.stringify(badTarget?.data?.result?.error ?? badTarget),
);

const blockedUrl = await driver.evaluate(async (tabId) => {
  await chrome.tabs.update(tabId, { active: true });
  return await chrome.runtime.sendMessage({
    type: "RUN_MOCK_ACTION",
    action: { action: "navigate", url: "javascript:alert(1)" },
  });
}, testTabId);
check(
  "javascript: URL refused before execution",
  blockedUrl?.ok === false && blockedUrl?.error?.code === "INVALID_ACTION",
  JSON.stringify(blockedUrl?.error),
);

const health = await driver.evaluate(
  async () => await chrome.runtime.sendMessage({ type: "CHECK_HEALTH" }),
);
check("background answers a health probe", health?.ok === true, JSON.stringify(health));

// ---- the whole agent loop, driven by mock mode ---------------------------
await driver.evaluate(
  async () =>
    await chrome.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      settings: {
        mockMode: true,
        mockScenario: "auto",
        maxIterations: 5,
        waitAfterActionMs: 150,
        pageSettleTimeoutMs: 2000,
        backendUrl: "http://localhost:5000",
      },
    }),
);

await driver.evaluate(async (tabId) => {
  await chrome.tabs.update(tabId, { active: true });
  return await chrome.runtime.sendMessage({ type: "START_LOOP" });
}, testTabId);

let snapshot = null;
for (let attempt = 0; attempt < 60; attempt += 1) {
  await new Promise((r) => setTimeout(r, 500));
  snapshot = await driver.evaluate(
    async () => await chrome.runtime.sendMessage({ type: "GET_SNAPSHOT" }),
  );
  if (snapshot?.data && snapshot.data.loop?.running === false) break;
}

const loop = snapshot?.data?.loop;
const messages = (snapshot?.data?.logs ?? []).map((e) => e.message).join(" | ");
check("agent loop ran and stopped on its own", loop?.running === false, JSON.stringify(loop));
check(
  "agent loop honoured the iteration limit",
  typeof loop?.iteration === "number" && loop.iteration >= 1 && loop.iteration <= 5,
  String(loop?.iteration),
);
check(
  "agent loop stopped because the mock agent finished",
  /completed/i.test(loop?.stoppedReason ?? ""),
  loop?.stoppedReason,
);
check("loop chose a type action", /type el_/i.test(messages), messages.slice(0, 400));
check("loop iterated and re-read", /Iteration 2/i.test(messages), messages.slice(0, 400));
check(
  "loop log is observable from the popup surface",
  (snapshot?.data?.logs ?? []).length > 4,
  String((snapshot?.data?.logs ?? []).length),
);
// ---- cleanup + report ----------------------------------------------------
await cleanup();

let failed = 0;
for (const c of checks) {
  const mark = c.ok ? "PASS" : "FAIL";
  if (!c.ok) failed += 1;
  const detail = c.ok || c.detail === undefined ? "" : `  -> ${c.detail}`;
  console.log(`[${mark}] ${c.name}${detail}`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
process.exit(failed > 0 ? 1 : 0);