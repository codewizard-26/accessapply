/**
 * smoke-test.mjs - runs the pure-logic modules under Node, with no browser.
 *
 * Covers the trust boundary: action validation, URL policy, settings
 * validation, wire sanitisation and mock-mode behaviour. The DOM-dependent
 * parts (scanner/actions) are exercised manually in Chrome via test-page/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = await mkdtemp(path.join(tmpdir(), "accessapply-test-"));

// Bundle the testable entry (no chrome.* APIs) to a temp ESM file.
const entry = path.join(tmp, "entry.ts");
await build({
  entryPoints: [path.join(root, "src", "testable.ts")],
  outfile: entry,
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["node20"],
  logLevel: "warning",
});

const mod = await import(pathToFileURL(entry).href);
const {
  validateAction,
  validateUrl,
  validateSettings,
  DEFAULT_SETTINGS,
  sanitizePageForWire,
  mockNextAction,
  MOCK_SCENARIOS,
} = mod;

const samplePage = {
  url: "http://localhost:8080/test-page/index.html",
  title: "Frontend Developer",
  text: "Requirements. TypeScript.",
  elements: [
    {
      id: "el_1",
      type: "button",
      text: "Apply Now",
      accessibleName: "Apply Now",
    },
    {
      id: "el_2",
      type: "input",
      label: "Email address",
      placeholder: "jane@example.com",
      inputType: "email",
    },
    {
      id: "el_3",
      type: "input",
      label: "Password",
      inputType: "password",
      value: "hunter2",
    },
  ],
};

test("validateAction accepts the five documented actions", () => {
  assert.equal(validateAction({ action: "click", target: "el_1" }).ok, true);
  assert.equal(
    validateAction({ action: "type", target: "el_2", value: "a@b.com" }).ok,
    true,
  );
  assert.equal(
    validateAction({ action: "scroll", direction: "down" }).ok,
    true,
  );
  assert.equal(
    validateAction({ action: "navigate", url: "https://example.com" }).ok,
    true,
  );
  assert.equal(validateAction({ action: "read" }).ok, true);
});

test("validateAction rejects malformed and hostile input", () => {
  assert.equal(validateAction({ action: "click" }).ok, false, "missing target");
  assert.equal(
    validateAction({ action: "type", target: "el_1" }).ok,
    false,
    "missing value",
  );
  assert.equal(
    validateAction({ action: "type", target: "el_1", value: 42 }).ok,
    false,
    "non-string value",
  );
  assert.equal(
    validateAction({ action: "scroll", direction: "sideways" }).ok,
    false,
  );
  assert.equal(
    validateAction({ action: "navigate", url: "javascript:alert(1)" }).ok,
    false,
  );
  assert.equal(
    validateAction({ action: "exec", code: "rm -rf" }).ok,
    false,
    "unknown action",
  );
  assert.equal(validateAction(null).ok, false);
  assert.equal(validateAction("click el_1").ok, false);
  assert.equal(validateAction([]).ok, false);
});

test("validateAction tolerates a wrapped backend response", () => {
  const wrapped = validateAction({
    action: { action: "click", target: "el_9" },
  });
  assert.equal(wrapped.ok, true);
  assert.equal(wrapped.value.target, "el_9");
});

test("validateUrl allows http(s) only", () => {
  assert.equal(validateUrl("https://example.com/jobs").ok, true);
  assert.equal(validateUrl("http://localhost:5000").ok, true);
  for (const bad of [
    "javascript:alert(1)",
    "data:text/html,<script>",
    "file:///etc/passwd",
    "vbscript:msgbox",
    "chrome://settings",
    "not a url",
    "",
  ]) {
    assert.equal(validateUrl(bad).ok, false, `should reject: ${bad}`);
  }
});

test("validateSettings clamps and defaults", () => {
  const s = validateSettings({
    maxIterations: 9999,
    mockMode: "yes",
    backendUrl: "http://localhost:5000/",
  });
  assert.equal(s.ok, true);
  assert.equal(s.value.maxIterations, 50);
  assert.equal(
    s.value.mockMode,
    true,
    "defaults when the value is not a boolean",
  );
  assert.equal(
    s.value.backendUrl,
    "http://localhost:5000",
    "trailing slash trimmed",
  );
  assert.equal(s.value.nextActionPath, DEFAULT_SETTINGS.nextActionPath);
  assert.equal(validateSettings({ backendUrl: "javascript:x" }).ok, false);
});

test("sanitizePageForWire strips sensitive values", () => {
  const wire = sanitizePageForWire(samplePage);
  const password = wire.elements.find((e) => e.id === "el_3");
  assert.equal(password.value, undefined, "password value must not be sent");
  const email = wire.elements.find((e) => e.id === "el_2");
  assert.equal(email.value, undefined, "empty value stays absent");
});

test("mock mode needs no backend and returns real actions", async () => {
  for (const scenario of ["click", "type", "scroll", "read"]) {
    const res = mockNextAction(
      { ...DEFAULT_SETTINGS, mockMode: true, mockScenario: scenario },
      { sessionId: "s", iteration: 1, page: samplePage },
    );
    assert.equal(res.ok, true, `scenario ${scenario}`);
    assert.equal(res.source, "mock");
  }

  const auto = [];
  for (let i = 1; i <= 5; i += 1) {
    const res = mockNextAction(
      { ...DEFAULT_SETTINGS, mockMode: true, mockScenario: "auto" },
      { sessionId: "s", iteration: i, page: samplePage },
    );
    assert.equal(res.ok, true);
    auto.push(res.action.action);
  }
  assert.deepEqual(auto.slice(0, 4), ["type", "click", "scroll", "done"]);
});

test("mock mode can simulate failures", () => {
  const invalid = mockNextAction(
    { ...DEFAULT_SETTINGS, mockScenario: "invalid_action" },
    { sessionId: "s", iteration: 1, page: samplePage },
  );
  // The mock returns something unusable on purpose; validation must reject it.
  assert.equal(invalid.ok, true);
  assert.equal(
    validateAction(invalid.action).ok,
    false,
    "invalid_action must fail validation",
  );

  const bad = mockNextAction(
    { ...DEFAULT_SETTINGS, mockScenario: "invalid_response" },
    { sessionId: "s", iteration: 1, page: samplePage },
  );
  assert.equal(bad.ok, false);

  const err = mockNextAction(
    { ...DEFAULT_SETTINGS, mockScenario: "backend_error" },
    { sessionId: "s", iteration: 1, page: samplePage },
  );
  assert.equal(err.ok, false);
  assert.equal(err.error.code, "BACKEND_ERROR");
});

test("mock navigate produces an http(s) url", () => {
  const res = mockNextAction(
    { ...DEFAULT_SETTINGS, mockScenario: "navigate" },
    { sessionId: "s", iteration: 1, page: samplePage },
  );
  assert.equal(res.ok, true);
  assert.equal(validateUrl(res.action.url).ok, true);
});

test("every advertised mock scenario is handled", () => {
  for (const scenario of MOCK_SCENARIOS) {
    const res = mockNextAction(
      { ...DEFAULT_SETTINGS, mockScenario: scenario },
      { sessionId: "s", iteration: 1, page: samplePage },
    );
    assert.ok(res.ok || res.error, `scenario ${scenario} returned something`);
  }
});

await rm(tmp, { recursive: true, force: true });
