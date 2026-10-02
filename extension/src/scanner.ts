/**
 * scanner.ts - read the active page into a typed, screen-reader-friendly
 * `PageContext`.
 *
 * Design rules:
 *  - Semantic HTML / ARIA / labels are preferred over raw visual heuristics.
 *  - Hidden, script, style and decorative nodes are never emitted.
 *  - Every actionable element gets a stable id (`el_1`, `el_2`, ...) which is
 *    stored in a WeakMap so an action can resolve the id back to a live DOM
 *    node. Ids are only valid for the scan that produced them; the action layer
 *    revalidates before touching the element.
 *  - Sensitive values (passwords etc.) are never captured.
 */

import type {
  ElementType,
  JobInfo,
  PageContext,
  PageElement,
} from "./types.js";

/** id -> element, for the most recent scan in this document. */
const elementRegistry = new Map<string, HTMLElement>();

/** Monotonically increasing suffix so ids never collide within one scan. */
let scanCounter = 0;

const MAX_TEXT_LENGTH = 4000;
const MAX_ELEMENT_TEXT = 200;
const MAX_ELEMENTS = 500;

const NON_ACTIONABLE = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  "head",
  "meta",
  "link",
  "title",
]);

function clean(
  value: string | null | undefined,
  max = MAX_ELEMENT_TEXT,
): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function isVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const style = window.getComputedStyle(el);
  if (!style) return false;
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse"
  )
    return false;
  if (style.opacity === "0") return false;
  if (el.hasAttribute("hidden")) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  // offsetParent is null for display:none subtrees; fixed elements report null
  // too, so combine with a rect check.
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    // An element can be legitimately zero-sized (e.g. a wrapper), so only
    // reject when it also has no layout box.
    if (
      el.offsetParent === null &&
      style.position !== "fixed" &&
      style.position !== "sticky"
    )
      return false;
  }
  return true;
}

/** True when the element is only exposed to assistive tech (e.g. sr-only). */
function isVisuallyHiddenButExposed(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (!style) return false;
  const clipped =
    style.clip === "rect(0px, 0px, 0px, 0px)" ||
    style.clipPath === "inset(50%)" ||
    (style.width === "1px" && style.height === "1px");
  return clipped && style.position === "absolute";
}

function isDecorative(el: HTMLElement): boolean {
  if (el.getAttribute("aria-hidden") === "true") return true;
  if (el.hasAttribute("hidden")) return true;
  const role = (el.getAttribute("role") || "").toLowerCase();
  if (role === "presentation" || role === "none") return true;
  const style = window.getComputedStyle(el);
  return !!style && style.display === "none";
}

/** Compute the accessible name, preferring explicit sources. */
function accessibleName(el: HTMLElement): string {
  const ariaLabel = clean(el.getAttribute("aria-label"));
  if (ariaLabel) return ariaLabel;

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((n): n is HTMLElement => !!n)
      .map((n) => clean(n.textContent, 300));
    const joined = clean(parts.join(" "), 300);
    if (joined) return joined;
  }

  // <label for> / wrapping <label>
  const id = el.getAttribute("id");
  if (id) {
    const escaped = id.replace(/"/g, '\\"');
    const label = document.querySelector(`label[for="${escaped}"]`);
    if (label) {
      const t = clean(label.textContent, 300);
      if (t) return t;
    }
  }
  const wrapping = el.closest("label");
  if (wrapping) {
    const t = clean(wrapping.textContent, 300);
    if (t) return t;
  }

  const title = clean(el.getAttribute("title"));
  if (title) return title;

  const text = clean(el.textContent);
  if (text) return text;

  const alt = clean(el.getAttribute("alt"));
  if (alt) return alt;

  return "";
}

/** Label text associated with a form control, without the value fallback. */
function labelFor(el: HTMLElement): string {
  const id = el.getAttribute("id");
  if (id) {
    const escaped = id.replace(/"/g, '\\"');
    const label = document.querySelector(`label[for="${escaped}"]`);
    if (label) {
      const t = clean(label.textContent, 300);
      if (t) return t;
    }
  }
  const wrapping = el.closest("label");
  if (wrapping) {
    // Prefer the direct text of the wrapping label.
    const t = clean(wrapping.textContent, 300);
    if (t) return t;
  }
  const ariaLabel = clean(el.getAttribute("aria-label"));
  if (ariaLabel) return ariaLabel;
  return "";
}

function resolveRole(el: HTMLElement): string {
  const explicit = clean(el.getAttribute("role"), 60);
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "a":
      return el.hasAttribute("href") ? "link" : "";
    case "button":
      return "button";
    case "textarea":
      return "textbox";
    case "select":
      return el.hasAttribute("multiple") || (el as HTMLSelectElement).size > 1
        ? "listbox"
        : "combobox";
    case "input":
      return roleForInput(el as HTMLInputElement);
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return "heading";
    case "form":
      return "form";
    case "img":
      return "img";
    case "li":
      return "listitem";
    default:
      return "";
  }
}

function roleForInput(input: HTMLInputElement): string {
  switch ((input.type || "text").toLowerCase()) {
    case "checkbox":
      return "checkbox";
    case "radio":
      return "radio";
    case "submit":
    case "button":
    case "reset":
    case "image":
      return "button";
    case "range":
      return "slider";
    case "number":
      return "spinbutton";
    case "search":
      return "searchbox";
    case "email":
    case "tel":
    case "url":
    case "text":
    case "password":
    default:
      return "textbox";
  }
}

function typeFor(el: HTMLElement, role: string): ElementType {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "button":
      return "button";
    case "a":
      return "link";
    case "textarea":
      return "textarea";
    case "select":
      return "select";
    case "input": {
      const t = ((el as HTMLInputElement).type || "text").toLowerCase();
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      return "input";
    }
    case "option":
      return "option";
    case "li":
      return "listitem";
    case "form":
      return "form";
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return "heading";
    default:
      break;
  }
  if (role === "heading") return "heading";
  return "text";
}

/** Input types whose value must never leave the browser. */
const SENSITIVE_INPUT_TYPES = new Set(["password"]);

function isSensitiveInput(el: HTMLElement): boolean {
  if (el.tagName.toLowerCase() !== "input") return false;
  const type = ((el as HTMLInputElement).type || "text").toLowerCase();
  if (SENSITIVE_INPUT_TYPES.has(type)) return true;
  const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
  return /password|cc-number|cvv|c-csc|one-time-code/.test(autocomplete);
}

function describeElement(el: HTMLElement, index: number): PageElement | null {
  const tag = el.tagName.toLowerCase();
  if (NON_ACTIONABLE.has(tag)) return null;
  if (isDecorative(el)) return null;
  if (!isVisible(el) && !isVisuallyHiddenButExposed(el)) return null;

  const role = resolveRole(el);
  const type = typeFor(el, role);
  const id = `el_${index}`;
  const accessible = accessibleName(el);
  const text = clean(el.textContent);

  // Only include elements that carry meaning: interactive, labelled or
  // structural. This keeps the payload small for screen-reader users.
  const interactive =
    role === "button" ||
    role === "link" ||
    role === "textbox" ||
    role === "searchbox" ||
    role === "combobox" ||
    role === "listbox" ||
    role === "checkbox" ||
    role === "radio" ||
    role === "slider" ||
    role === "spinbutton" ||
    role === "switch" ||
    role === "menuitem" ||
    role === "tab" ||
    tag === "summary" ||
    el.hasAttribute("tabindex") ||
    el.hasAttribute("contenteditable");

  const structural =
    type === "heading" ||
    role === "heading" ||
    tag === "label" ||
    role === "listitem" ||
    type === "form";

  if (!interactive && !structural && !text) return null;

  const element: PageElement = {
    id,
    type,
    order: index,
    tag,
    role: role || undefined,
    accessibleName: accessible || undefined,
    text: text || undefined,
    disabled: isDisabled(el),
    required: isRequired(el),
  };

  const label = labelFor(el);
  if (label) {
    element.label = label;
    if (labelForAttribute(el)) element.labelFor = labelForAttribute(el);
  }

  const placeholder = clean(el.getAttribute("placeholder"));
  if (placeholder) element.placeholder = placeholder;

  const ariaLabel = clean(el.getAttribute("aria-label"));
  if (ariaLabel) element.ariaLabel = ariaLabel;

  if (tag === "input" || tag === "textarea") {
    element.inputType = ((el as HTMLInputElement).type || "text").toLowerCase();
  }

  if (tag === "a") {
    const anchor = el as HTMLAnchorElement;
    if (anchor.href) element.href = anchor.href;
  }

  if (tag === "button" && (el as HTMLButtonElement).type) {
    element.inputType = (el as HTMLButtonElement).type;
  }

  const expanded = el.getAttribute("aria-expanded");
  if (expanded === "true" || expanded === "false")
    element.expanded = expanded === "true";

  if (tag === "select") {
    const select = el as HTMLSelectElement;
    element.options = Array.from(select.options)
      .slice(0, 50)
      .map((o) => clean(o.textContent, 80))
      .filter(Boolean);
  }

  const valueNow = el.getAttribute("aria-valuenow");
  if (valueNow !== null) {
    const n = Number(valueNow);
    if (Number.isFinite(n)) {
      element.valueNow = n;
      const min = el.getAttribute("aria-valuemin");
      const max = el.getAttribute("aria-valuemax");
      if (min !== null && Number.isFinite(Number(min)))
        element.valueMin = Number(min);
      if (max !== null && Number.isFinite(Number(max)))
        element.valueMax = Number(max);
    }
  }

  if (/^h[1-6]$/.test(tag)) {
    element.level = Number(tag.slice(1));
  }

  // Value is included so the backend knows what has already been filled in,
  // but never for sensitive fields.
  if (!isSensitiveInput(el)) {
    if (tag === "select") {
      const selected = (el as HTMLSelectElement).value;
      if (selected) element.value = clean(selected, 200);
    } else if (
      "value" in el &&
      typeof (el as HTMLInputElement).value === "string"
    ) {
      const v = clean((el as HTMLInputElement).value, 200);
      if (v) element.value = v;
    }
  }

  return element;
}

function labelForAttribute(el: HTMLElement): string {
  const id = el.getAttribute("id");
  if (!id) return "";
  const escaped = id.replace(/"/g, '\\"');
  const label = document.querySelector(`label[for="${escaped}"]`);
  return label ? label.getAttribute("for") || "" : "";
}

function isDisabled(el: HTMLElement): boolean {
  if ((el as HTMLInputElement).disabled === true) return true;
  if (el.hasAttribute("disabled")) return true;
  if (el.getAttribute("aria-disabled") === "true") return true;
  const fieldset = el.closest("fieldset[disabled]");
  if (fieldset && el.tagName.toLowerCase() !== "legend") return true;
  return false;
}

function isRequired(el: HTMLElement): boolean {
  if (el.hasAttribute("required")) return true;
  if (el.getAttribute("aria-required") === "true") return true;
  return false;
}

/** Elements we consider worth scanning, in document order. */
function candidateSelector(): string {
  return [
    "a[href]",
    "button",
    "input",
    "textarea",
    "select",
    "summary",
    "label",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "li",
    "[role]",
    "[tabindex]",
    "[contenteditable]",
    "[aria-label]",
    "[aria-labelledby]",
    "main p",
    "main li",
    "article p",
    "article li",
    "[class*='job']",
    "[id*='job']",
    "[class*='description']",
    "[class*='requirement']",
    "[class*='apply']",
    "[data-testid]",
  ].join(", ");
}

/** Read the meaningful visible prose of the page. */
function readText(root: HTMLElement): string {
  const parts: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName.toLowerCase();
      if (NON_ACTIONABLE.has(tag)) return NodeFilter.FILTER_REJECT;
      if (tag === "head") return NodeFilter.FILTER_REJECT;
      if (!isVisible(parent)) return NodeFilter.FILTER_REJECT;
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let current = walker.nextNode();
  while (current) {
    parts.push((current.textContent || "").replace(/\s+/g, " ").trim());
    current = walker.nextNode();
  }
  return parts.join(" ").slice(0, MAX_TEXT_LENGTH);
}

// ---------------------------------------------------------------------------
// Job information heuristics
// ---------------------------------------------------------------------------

/** JobInfo fields that are plain strings and can be filled by regex. */
type StringJobField = "title" | "company" | "location" | "employmentType" | "salary";

const JOB_LABEL_PATTERNS: Array<[StringJobField, RegExp]> = [
  [
    "employmentType",
    /(full[\s-]?time|part[\s-]?time|contract|permanent|temporary|internship)/i,
  ],
  [
    "salary",
    /(?:[$€£]\s?[\d,]+(?:\.\d+)?\s?(?:k|K)?(?:\s?(?:\/|per)\s?(?:hour|year|month|yr|hr))?)/i,
  ],
];

function firstMatchFor(pattern: RegExp, scope: string): string | undefined {
  const m = pattern.exec(scope);
  return m ? clean(m[0], 120) : undefined;
}

function findLabelledValue(
  labels: string[],
  scope: string,
): string | undefined {
  for (const label of labels) {
    const idx = scope.toLowerCase().indexOf(label.toLowerCase());
    if (idx === -1) continue;
    const tail = scope.slice(idx + label.length, idx + label.length + 160);
    const value = tail.replace(/^[\s:–—-]+/, "").split(/[\n|;]/)[0];
    const cleaned = clean(value || "", 160);
    if (cleaned) return cleaned;
  }
  return undefined;
}

function detectWorkMode(scope: string): JobInfo["workMode"] {
  if (
    /\bfully?\s+remote\b|\bremote[\s-]?(?:first|position|work)\b|\b100%\s*remote\b/i.test(
      scope,
    )
  )
    return "remote";
  if (/\bhybrid\b/i.test(scope)) return "hybrid";
  if (/\bon[\s-]?site\b|\bin[\s-]?office\b|\bin[\s-]?person\b/i.test(scope))
    return "onsite";
  return "unknown";
}

function extractJobInfo(
  context: PageContext,
  headings: PageElement[],
): JobInfo | undefined {
  const scope = `${context.title} ${context.text}`;
  const job: JobInfo = {};

  const h1 = headings.find((h) => h.level === 1);
  const firstHeading = headings[0];
  const title = h1?.text || firstHeading?.text || "";
  if (title) job.title = clean(title, 200);

  if (/job|position|opening|career|vacanc|employ/i.test(scope)) {
    for (const [key, pattern] of JOB_LABEL_PATTERNS) {
      const value = firstMatchFor(pattern, scope);
      if (value) job[key] = value;
    }

    job.workMode = detectWorkMode(scope);

    const location = findLabelledValue(
      ["location", "based in", "office", "city"],
      scope,
    );
    if (location) job.location = clean(location, 160);

    const company = findLabelledValue(
      ["company", "employer", "organisation", "organization"],
      scope,
    );
    if (company) job.company = clean(company, 160);

    const applyLink = context.elements.find(
      (e) =>
        e.type === "link" && /apply/i.test(e.accessibleName || e.text || ""),
    );
    if (applyLink?.href) job.applyUrl = applyLink.href;

    const applyText = findLabelledValue(
      ["how to apply", "application instructions", "to apply", "apply by"],
      scope,
    );
    if (applyText) job.applicationInstructions = clean(applyText, 600);

    // Requirements / description: collect bullet list items under a heading
    // that mentions requirements or responsibilities.
    const requirementHeading = headings.find((h) =>
      /requirement|qualification|responsibilit|what you.ll need|skills/i.test(
        h.text || "",
      ),
    );
    if (requirementHeading) {
      const requirements = collectListAfter(requirementHeading);
      if (requirements.length) job.requirements = requirements;
    }

    const descHeading = headings.find((h) =>
      /description|about (?:the )?(?:role|job|position)|overview|summary/i.test(
        h.text || "",
      ),
    );
    if (descHeading) {
      const desc = collectParagraphsAfter(descHeading);
      if (desc) job.description = clean(desc, 1200);
    }
  }

  const hasAny = Object.values(job).some(
    (v) => v !== undefined && v !== "unknown",
  );
  return hasAny ? job : undefined;
}

function collectListAfter(heading: PageElement): string[] {
  const headingEl = elementRegistry.get(heading.id);
  if (!headingEl) return [];
  const results: string[] = [];
  let node = headingEl.nextElementSibling;
  let guard = 0;
  while (node && guard++ < 10) {
    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) break;
    if (tag === "ul" || tag === "ol") {
      for (const li of Array.from(node.querySelectorAll("li"))) {
        const t = clean(li.textContent, 300);
        if (t) results.push(t);
        if (results.length >= 30) return results;
      }
    }
    node = node.nextElementSibling;
  }
  return results;
}

function collectParagraphsAfter(heading: PageElement): string {
  const headingEl = elementRegistry.get(heading.id);
  if (!headingEl) return "";
  const parts: string[] = [];
  let node = headingEl.nextElementSibling;
  let guard = 0;
  while (node && guard++ < 8) {
    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) break;
    if (tag === "p") parts.push(clean(node.textContent, 800));
    node = node.nextElementSibling;
  }
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan the document and return a structured `PageContext`.
 * Clears the id registry first so ids always reflect the latest scan.
 */
export function scanPage(): PageContext {
  scanCounter += 1;
  elementRegistry.clear();

  const active = document.activeElement as HTMLElement | null;
  const root = document.body;
  const url = location.href;
  const title = document.title || "";

  const elements: PageElement[] = [];
  let index = 0;
  const seen = new Set<Element>();

  let nodes: Element[] = [];
  try {
    nodes = Array.from(document.querySelectorAll(candidateSelector()));
  } catch {
    nodes = [];
  }

  for (const node of nodes) {
    if (elements.length >= MAX_ELEMENTS) break;
    if (!(node instanceof HTMLElement)) continue;
    // Skip elements already represented by an ancestor in the result set,
    // except when the node is itself interactive.
    if (seen.has(node)) continue;
    index += 1;
    const described = describeElement(node, index);
    if (!described) continue;

    const role = described.role;
    const interactive =
      role === "button" ||
      role === "link" ||
      role === "textbox" ||
      role === "searchbox" ||
      role === "combobox" ||
      role === "listbox" ||
      role === "checkbox" ||
      role === "radio" ||
      role === "slider" ||
      role === "spinbutton" ||
      role === "menuitem" ||
      role === "tab";

    if (!interactive) {
      const parent = node.parentElement;
      if (parent && seen.has(parent)) continue;
      if (parent) seen.add(parent);
    }
    seen.add(node);

    elementRegistry.set(described.id, node);
    elements.push(described);
  }

  const focusedElementId =
    active && elementRegistry.has(findIdFor(active))
      ? findIdFor(active)
      : undefined;

  const context: PageContext = {
    url,
    title,
    text: readText(root ?? document.documentElement),
    elements,
    scannedAt: Date.now(),
    loading: document.readyState === "loading",
  };

  const headings = elements.filter((e) => e.type === "heading");
  const job = extractJobInfo(context, headings);
  if (job) context.job = job;
  if (focusedElementId) context.focusedElementId = focusedElementId;

  return context;
}

function findIdFor(el: HTMLElement): string {
  for (const [id, node] of elementRegistry) {
    if (node === el) return id;
  }
  return "";
}

/**
 * Resolve a scan id back to its DOM element.
 * Returns undefined when the id is unknown or the node has been detached.
 */
export function resolveElement(id: string): HTMLElement | undefined {
  const el = elementRegistry.get(id);
  if (!el) return undefined;
  if (!el.isConnected) return undefined;
  return el;
}

/** Re-check that an element is still a valid target for an action. */
export function revalidateElement(
  id: string,
):
  | { ok: true; element: HTMLElement }
  | { ok: false; reason: "unknown" | "detached" } {
  const element = elementRegistry.get(id);
  if (!element) return { ok: false, reason: "unknown" };
  if (!element.isConnected) return { ok: false, reason: "detached" };
  return { ok: true, element };
}

/** Number of elements currently registered - used by tests/diagnostics. */
export function registeredCount(): number {
  return elementRegistry.size;
}

/** Clear the registry (used when navigating away). */
export function resetRegistry(): void {
  elementRegistry.clear();
}
