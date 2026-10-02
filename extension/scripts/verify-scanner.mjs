/**
 * verify-scanner.mjs - end-to-end browser verification of the real scanner and
 * action executor (not mocks) against `test-page/index.html`.
 *
 * It bundles `src/dom-testable.ts` with esbuild, launches the locally installed
 * Chrome through `playwright-core` (no browser download), loads the test page,
 * injects the bundle and runs the full flow:
 *
 *   READ PAGE -> MOCK ACTION -> VALIDATE -> EXECUTE -> READ AGAIN
 *
 * plus the failure paths (unknown / disabled / detached targets, blocked URLs),
 * proving the executor returns structured errors instead of throwing.
 *
 * Run with: npm run test:browser
 * Exits 0 with a [skip] note when Chrome or playwright-core is unavailable.
 */
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testPage = path.join(root, "test-page", "index.html");

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

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.log("[skip] playwright-core is not installed.");
  process.exit(0);
}

const executablePath = findChrome();
if (!executablePath) {
  console.log("[skip] No local Chrome/Edge binary found (set CHROME_PATH).");
  process.exit(0);
}

// Bundle the DOM test surface (esbuild write:false -> in-memory string).
const bundle = await build({
  entryPoints: [path.join(root, "src", "dom-testable.ts")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["chrome116"],
  logLevel: "warning",
});
const bundleCode = bundle.outputFiles[0].text;

const checks = [];
function check(name, condition, detail) {
  checks.push({ name, ok: !!condition, detail });
}

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto(`file:///${testPage.replace(/\\/g, "/")}`, {
    waitUntil: "load",
  });
  await page.addScriptTag({ content: bundleCode });

  const scan = await page.evaluate(() => {
    const ctx = window.AA.scanPage();
    const pick = (pred) => ctx.elements.filter(pred);
    return {
      url: ctx.url,
      title: ctx.title,
      elementCount: ctx.elements.length,
      job: ctx.job ?? null,
      leaksHidden: /INTERNAL_SECRET_TOKEN|ANOTHER_HIDDEN_TOKEN/.test(ctx.text),
      headings: pick((e) => e.type === "heading").map(
        (e) => `${e.level}:${e.text}`,
      ),
      buttons: pick((e) => e.type === "button").map((e) => ({
        id: e.id,
        name: e.accessibleName,
        disabled: !!e.disabled,
      })),
      inputs: pick((e) => e.type === "input").map((e) => ({
        id: e.id,
        label: e.label,
        placeholder: e.placeholder,
        type: e.inputType,
        required: !!e.required,
        value: e.value,
      })),
      textareas: pick((e) => e.type === "textarea").map((e) => ({
        id: e.id,
        label: e.label,
        placeholder: e.placeholder,
      })),
      selects: pick((e) => e.type === "select").map((e) => ({
        id: e.id,
        label: e.label,
        options: e.options,
      })),
      links: pick((e) => e.type === "link").map((e) => ({
        id: e.id,
        name: e.accessibleName,
        href: e.href,
      })),
      registered: window.AA.registeredCount(),
    };
  });

  // ---- 1. scan ----------------------------------------------------------
  check("scan: url is the test page", /test-page\/index\.html$/.test(scan.url), scan.url);
  check("scan: title read", scan.title.includes("Frontend Developer"), scan.title);
  check("scan: elements found", scan.elementCount > 10, `${scan.elementCount} elements`);
  check(
    "scan: h1 heading captured",
    scan.headings.includes("1:Frontend Developer"),
    scan.headings.join(" | "),
  );
  check(
    "scan: aria-labelled button uses its accessible name",
    scan.buttons.some((b) => b.name === "Save job to my list"),
  );
  check(
    "scan: disabled button flagged",
    scan.buttons.some((b) => b.name === "Unavailable" && b.disabled),
  );
  const email = scan.inputs.find((i) => i.label === "Email address");
  check("scan: email input label", !!email);
  check("scan: email input placeholder", email?.placeholder === "jane@example.com");
  check("scan: email input required", email?.required === true);
  check("scan: email input type", email?.type === "email");
  check(
    "scan: password value never captured",
    !scan.inputs.some((i) => i.type === "password" && i.value !== undefined),
  );
  check(
    "scan: textarea label + placeholder",
    scan.textareas.some((t) => t.label === "Cover letter" && !!t.placeholder),
  );
  check(
    "scan: select options captured",
    scan.selects.some((s) => (s.options ?? []).includes("2 weeks")),
  );
  check(
    "scan: link href resolved absolute",
    scan.links.some((l) => l.href === "https://example.com/privacy"),
  );
  check("scan: hidden content never leaked", scan.leaksHidden === false);
  check(
    "scan: ids registered 1:1 with elements",
    scan.registered === scan.elementCount,
    `${scan.registered}/${scan.elementCount}`,
  );
  check("scan: job title extracted", scan.job?.title === "Frontend Developer", JSON.stringify(scan.job));
  check("scan: job work mode = remote", scan.job?.workMode === "remote", JSON.stringify(scan.job?.workMode));
  check(
    "scan: job employment type",
    /full-?time/i.test(scan.job?.employmentType ?? ""),
    scan.job?.employmentType,
  );
  check(
    "scan: job requirements collected",
    (scan.job?.requirements ?? []).length >= 3,
    JSON.stringify(scan.job?.requirements),
  );


  // ---- 2. mock-driven action loop + re-read -----------------------------
  const loop = await page.evaluate(async () => {
    const settings = { ...window.AA.DEFAULT_SETTINGS, mockMode: true, mockScenario: "auto" };
    const snapshot = () => window.AA.scanPage();
    const steps = [];

    // iteration 1 -> type into the email field
    let current = snapshot();
    let next = window.AA.mockNextAction(settings, { sessionId: "s", iteration: 1, page: current });
    let v = window.AA.validateAction(next.action);
    let r = v.ok ? window.AA.executeAction(v.value) : { ok: false };
    const after1 = snapshot();
    const emailAfter = after1.elements.find((e) => e.label === "Email address");
    steps.push({ action: next.action.action, ok: r.ok, value: emailAfter?.value });

    // iteration 2 -> click the details button
    next = window.AA.mockNextAction(settings, { sessionId: "s", iteration: 2, page: after1 });
    v = window.AA.validateAction(next.action);
    r = v.ok ? window.AA.executeAction(v.value) : { ok: false };
    steps.push({
      action: next.action.action,
      ok: r.ok,
      status: document.getElementById("result").textContent,
    });

    // iteration 3 -> scroll down
    next = window.AA.mockNextAction(settings, { sessionId: "s", iteration: 3, page: after1 });
    v = window.AA.validateAction(next.action);
    r = v.ok ? window.AA.executeAction(v.value) : { ok: false };
    steps.push({ action: next.action.action, ok: r.ok, data: r.data });
    await new Promise((resolve) => setTimeout(resolve, 700));

    return { steps, scrollY: window.scrollY };
  });

  check("loop: type step succeeded", loop.steps[0].ok === true);
  check(
    "loop: typed value visible on re-read",
    loop.steps[0].value === "test.user@example.com",
    loop.steps[0].value,
  );
  check("loop: click step succeeded", loop.steps[1].ok === true);
  check(
    "loop: click updated the page (re-read sees new state)",
    loop.steps[1].status === "Details expanded.",
    loop.steps[1].status,
  );
  check("loop: scroll step succeeded", loop.steps[2].ok === true);
  check("loop: page actually scrolled", loop.scrollY > 0, `scrollY=${loop.scrollY}`);

  // ---- 3. failure paths return structured errors, never throw -----------
  const failures = await page.evaluate(() => {
    const ctx = window.AA.scanPage();
    const disabled = ctx.elements.find((e) => e.disabled);
    const select = ctx.elements.find((e) => e.type === "select");

    const unknown = window.AA.executeAction({ action: "click", target: "el_99999" });
    const blocked = window.AA.validateAction({ action: "navigate", url: "javascript:alert(1)" });
    const disabledClick = window.AA.executeAction({ action: "click", target: disabled.id });
    const typeSelect = window.AA.executeAction({ action: "type", target: select.id, value: "x" });

    // detach then act -> must be reported, never forced
    const details = ctx.elements.find((e) => e.accessibleName === "Show more details");
    window.AA.resolveElement(details.id).remove();
    const detached = window.AA.executeAction({ action: "click", target: details.id });

    return {
      unknownCode: unknown.ok ? null : unknown.error.code,
      blockedOk: blocked.ok,
      disabledCode: disabledClick.ok ? null : disabledClick.error.code,
      typeSelectCode: typeSelect.ok ? null : typeSelect.error.code,
      detachedCode: detached.ok ? null : detached.error.code,
    };
  });

  check("failure: unknown target rejected", failures.unknownCode === "INVALID_TARGET", failures.unknownCode);
  check("failure: javascript: URL rejected by validation", failures.blockedOk === false);
  check("failure: disabled target rejected", failures.disabledCode === "TARGET_DISABLED", failures.disabledCode);
  check("failure: typing into a select rejected", failures.typeSelectCode === "TARGET_NOT_EDITABLE", failures.typeSelectCode);
  check("failure: detached target rejected", failures.detachedCode === "TARGET_DETACHED", failures.detachedCode);

  // ---- 4. wire sanitisation ---------------------------------------------
  const leaks = await page.evaluate(() => {
    const clean = window.AA.sanitizePageForWire(window.AA.scanPage());
    return clean.elements.some((e) => e.inputType === "password" && e.value !== undefined);
  });
  check("wire: sanitized page carries no password value", leaks === false);

  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join("; "));
} finally {
  await browser.close();
}

// ---- report -------------------------------------------------------------
let failed = 0;
for (const c of checks) {
  const mark = c.ok ? "PASS" : "FAIL";
  if (!c.ok) failed += 1;
  const detail = c.ok || c.detail === undefined ? "" : `  -> ${c.detail}`;
  console.log(`[${mark}] ${c.name}${detail}`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
process.exit(failed > 0 ? 1 : 0);

