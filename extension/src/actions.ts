/**
 * actions.ts - execution of validated actions inside the page.
 *
 * Safety rules enforced here:
 *  - The target id is re-resolved and the element revalidated immediately
 *    before the interaction (not when the action was planned).
 *  - Hidden / disabled / unsuitable targets are rejected, never forced.
 *  - No arbitrary JavaScript from the backend is ever evaluated.
 *  - Consequential actions (submitting an application, accepting a legal
 *    declaration) are refused unless the user explicitly authorized them via
 *    the popup.
 *  - Nothing is fabricated: the extension only types values it was given.
 */

import { revalidateElement, resolveElement, scanPage } from "./scanner.js";
import type {
  ActionFailureResult,
  ActionResult,
  AgentAction,
  ClickAction,
  NavigateAction,
  ReadAction,
  ScrollAction,
  TypeAction,
} from "./types.js";
import { validateUrl } from "./validate.js";

export interface ActionRiskDescriptor {
  tag?: string;
  role?: string;
  text?: string;
  ariaLabel?: string;
  href?: string;
  value?: string;
  inputType?: string;
}

export interface ActionContext {
  /** Consequential actions (submit/apply/consent) require explicit approval. */
  allowConsequentialActions: boolean;
}

export const DEFAULT_ACTION_CONTEXT: ActionContext = {
  allowConsequentialActions: false,
};

const LEGAL_CONSENT_PATTERN =
  /\b(accept|agree|consent|declaration|terms?|policy|attest|acknowledge|authorize|confirm)\b/i;

const SUBMISSION_PATTERN =
  /\b(submit|application|apply(?: now)?|register|finalize|complete|send(?: in)?|finish)\b/i;

const SAFE_NAVIGATION_PATTERN =
  /\b(cancel|close|dismiss|back|next|previous|continue|show|view|details|expand|read|search|filter|open|menu|more|less|skip|log ?in|sign ?in)\b/i;

export function classifyTargetRisk(
  description: ActionRiskDescriptor,
): "safe" | "consequential" | "uncertain" {
  const text = [
    description.ariaLabel ?? "",
    description.text ?? "",
    description.value ?? "",
    description.href ?? "",
  ]
    .join(" ")
    .trim();

  if (!text) return "safe";

  const tag = (description.tag ?? "").toLowerCase();
  const role = (description.role ?? "").toLowerCase();
  const href = (description.href ?? "").toLowerCase();
  const isLink = tag === "a" || role === "link";
  const isSubmitButton =
    tag === "button" ||
    tag === "input" ||
    role === "button" ||
    description.inputType === "submit";

  if (isLink) {
    if (LEGAL_CONSENT_PATTERN.test(text)) return "consequential";
    if (href.includes("/apply") || SUBMISSION_PATTERN.test(text)) {
      return "uncertain";
    }
    return "safe";
  }

  if (LEGAL_CONSENT_PATTERN.test(text)) return "consequential";
  if (isSubmitButton && SUBMISSION_PATTERN.test(text)) return "consequential";
  if (isSubmitButton && SAFE_NAVIGATION_PATTERN.test(text)) return "safe";
  if (SUBMISSION_PATTERN.test(text)) return "uncertain";
  return "safe";
}

type ActionFailureKeySource = {
  action: AgentAction["action"];
  target?: string;
};

export function createActionFailureKey(
  action: ActionFailureKeySource,
  code: string,
): string {
  const target =
    action.action === "click" || action.action === "type"
      ? action.target ?? "unknown"
      : "page";
  return `${action.action}:${target}:${code}`;
}

export function buildSafeRecoveryAction(_action: AgentAction): AgentAction {
  return {
    action: "read",
    reason: "Recovery: reading job details instead.",
  };
}

export function hasExplicitUserAuthorization(
  _action: AgentAction,
  ctx: ActionContext,
): boolean {
  return ctx.allowConsequentialActions === true;
}

function fail(
  action: AgentAction["action"] | undefined,
  code: ActionFailureResult["error"]["code"],
  message: string,
  detail?: string,
): ActionFailureResult {
  return { ok: false, action, error: { code, message, detail } };
}

function success(
  action: AgentAction["action"],
  message: string,
  data?: Record<string, unknown>,
): ActionResult {
  return { ok: true, action, message, data };
}

function isVisibleNow(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (!style) return false;
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (el.hasAttribute("hidden")) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 || el.offsetParent !== null;
}

function isDisabledNow(el: HTMLElement): boolean {
  if ((el as HTMLInputElement).disabled === true) return true;
  if (el.hasAttribute("disabled")) return true;
  if (el.getAttribute("aria-disabled") === "true") return true;
  const fieldset = el.closest("fieldset[disabled]");
  return !!(fieldset && el.tagName.toLowerCase() !== "legend");
}

function isConsequential(element: HTMLElement): boolean {
  const descriptor = {
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute("role") || undefined,
    text: (element.textContent || "").slice(0, 300),
    ariaLabel: element.getAttribute("aria-label") || undefined,
    href:
      element instanceof HTMLAnchorElement
        ? element.href
        : element.getAttribute("href") || undefined,
    value: (element as HTMLInputElement).value || undefined,
    inputType:
      element instanceof HTMLInputElement
        ? element.type || undefined
        : element instanceof HTMLButtonElement
          ? element.type || undefined
          : undefined,
  };

  const risk = classifyTargetRisk(descriptor);
  return risk === "consequential" || risk === "uncertain";
}

/** Forms whose submission would be a real job application. */
function isSubmitControl(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag === "input") {
    const type = ((element as HTMLInputElement).type || "").toLowerCase();
    return type === "submit" || type === "image";
  }
  if (tag === "button") {
    const type = (
      (element as HTMLButtonElement).type || "submit"
    ).toLowerCase();
    return type === "submit";
  }
  return element.getAttribute("role") === "button" && isConsequential(element);
}

function isEditable(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") {
    const type = ((el as HTMLInputElement).type || "text").toLowerCase();
    return [
      "text",
      "search",
      "email",
      "url",
      "tel",
      "password",
      "number",
    ].includes(type);
  }
  if ((el as HTMLElement).isContentEditable) return true;
  const role = el.getAttribute("role");
  return role === "textbox" || role === "searchbox" || role === "combobox";
}

/**
 * Set the value of an input using the native setter so frameworks that track
 * the property (React, Vue) observe the change.
 */
function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const proto = Object.getPrototypeOf(el) as object;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor && descriptor.set) {
    descriptor.set.call(el, value);
  } else {
    el.value = value;
  }
}

function dispatch(el: HTMLElement, type: string, init?: EventInit): boolean {
  const Ctor = type.startsWith("key") ? KeyboardEvent : Event;
  let event: Event;
  try {
    event = new Ctor(type, {
      bubbles: true,
      cancelable: type !== "keydown" && type !== "keyup",
      ...init,
    });
  } catch {
    event = new Event(type, { bubbles: true });
  }
  return el.dispatchEvent(event);
}

/** Wait until the document is not loading and layout has settled. */
export function waitForPageSettle(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (document.readyState !== "loading") {
      resolve();
      return;
    }
    const timer = window.setTimeout(() => {
      document.removeEventListener("DOMContentLoaded", onReady);
      resolve();
    }, timeoutMs);
    const onReady = () => {
      window.clearTimeout(timer);
      resolve();
    };
    document.addEventListener("DOMContentLoaded", onReady, { once: true });
  });
}

// ---------------------------------------------------------------------------
// click
// ---------------------------------------------------------------------------

function runClick(action: ClickAction, ctx: ActionContext): ActionResult {
  const check = revalidateElement(action.target);
  if (!check.ok) {
    return fail(
      "click",
      check.reason === "detached" ? "TARGET_DETACHED" : "INVALID_TARGET",
      check.reason === "detached"
        ? "Target element is no longer attached to the document. Re-scan required."
        : `Unknown target "${action.target}". Re-scan the page first.`,
    );
  }
  const element = check.element;

  if (!isVisibleNow(element)) {
    return fail("click", "TARGET_HIDDEN", "Target element is not visible.");
  }
  if (isDisabledNow(element)) {
    return fail("click", "TARGET_DISABLED", "Target element is disabled.");
  }

  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute("role");
  const clickable =
    tag === "button" ||
    tag === "a" ||
    tag === "summary" ||
    tag === "input" ||
    tag === "select" ||
    tag === "textarea" ||
    tag === "label" ||
    tag === "option" ||
    role === "button" ||
    role === "link" ||
    role === "checkbox" ||
    role === "radio" ||
    role === "tab" ||
    role === "menuitem" ||
    element.hasAttribute("tabindex") ||
    element.onclick !== null;
  if (!clickable) {
    return fail(
      "click",
      "UNSUPPORTED_TARGET",
      `Element <${tag}> is not an interactive target.`,
    );
  }

  if (!hasExplicitUserAuthorization(action, ctx)) {
    const consequential = isSubmitControl(element) || isConsequential(element);
    if (consequential) {
      return fail(
        "click",
        "REQUIRES_AUTHORIZATION",
        "This action would submit an application or accept a declaration and needs explicit user authorization.",
        `Target "${action.target}" looks consequential.`,
      );
    }
  }

  try {
    element.scrollIntoView({
      block: "center",
      behavior: "instant" as ScrollBehavior,
    });
  } catch {
    /* ignore */
  }

  // element.click() dispatches a full activation (trusted sites and React both
  // observe it); the extra event covers frameworks that listen manually.
  element.click();

  return success("click", `Clicked ${describeTarget(element)}.`);
}

function describeTarget(el: HTMLElement): string {
  const label =
    el.getAttribute("aria-label") ||
    (el.textContent || "").trim().slice(0, 60) ||
    el.getAttribute("name") ||
    el.tagName.toLowerCase();
  return `<${el.tagName.toLowerCase()}> "${label}"`;
}

// ---------------------------------------------------------------------------
// type
// ---------------------------------------------------------------------------

function runType(action: TypeAction, ctx: ActionContext): ActionResult {
  const check = revalidateElement(action.target);
  if (!check.ok) {
    return fail(
      "type",
      check.reason === "detached" ? "TARGET_DETACHED" : "INVALID_TARGET",
      check.reason === "detached"
        ? "Target element is no longer attached to the document. Re-scan required."
        : `Unknown target "${action.target}". Re-scan the page first.`,
    );
  }
  const element = check.element;

  if (!isVisibleNow(element))
    return fail("type", "TARGET_HIDDEN", "Target element is not visible.");
  if (isDisabledNow(element))
    return fail("type", "TARGET_DISABLED", "Target element is disabled.");
  if (
    element.getAttribute("aria-readonly") === "true" ||
    (element as HTMLInputElement).readOnly === true
  ) {
    return fail("type", "TARGET_NOT_EDITABLE", "Target element is read-only.");
  }
  if (!isEditable(element)) {
    return fail(
      "type",
      "TARGET_NOT_EDITABLE",
      `Element <${element.tagName.toLowerCase()}> does not accept typed text. Use click or select instead.`,
    );
  }

  const value = action.value;
  const next =
    action.append === true
      ? `${(element as HTMLInputElement).value ?? ""}${value}`
      : value;

  if (
    isConsequential(element) &&
    !hasExplicitUserAuthorization(action, ctx)
  ) {
    if (
      /consent|agree|terms|declaration|attest|acknowledge|policy/i.test(
        describeTarget(element),
      )
    ) {
      return fail(
        "type",
        "REQUIRES_AUTHORIZATION",
        "Typing into this field would constitute accepting a legal declaration and needs explicit user authorization.",
      );
    }
  }

  try {
    element.focus({ preventScroll: false });
  } catch {
    /* ignore */
  }

  const previous = (element as HTMLInputElement).value ?? "";
  try {
    if (element instanceof HTMLSelectElement) {
      const targetVal = next.trim().toLowerCase();
      let matched = false;
      for (const opt of Array.from(element.options)) {
        if (
          opt.value.toLowerCase() === targetVal ||
          opt.textContent?.trim().toLowerCase() === targetVal ||
          opt.textContent?.trim().toLowerCase().includes(targetVal)
        ) {
          element.value = opt.value;
          matched = true;
          break;
        }
      }
      if (!matched && element.options.length > 0) {
        element.value = next;
      }
    } else if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
    ) {
      setNativeValue(element, next);
    } else {
      (element as HTMLElement).textContent = next;
    }
  } catch (error) {
    return fail(
      "type",
      "INTERNAL_ERROR",
      "Could not set the field value.",
      String(error),
    );
  }

  dispatch(element, "input");
  dispatch(element, "change");

  if (action.blur !== false) {
    try {
      element.blur();
    } catch {
      /* ignore */
    }
    dispatch(element, "blur");
  }

  const maxLength = (element as HTMLInputElement).maxLength;
  if (maxLength > 0 && next.length > maxLength) {
    return success(
      "type",
      `Typed into ${describeTarget(element)} (value truncated by maxlength).`,
      {
        length: (element as HTMLInputElement).value?.length ?? 0,
        maxLength,
      },
    );
  }

  return success("type", `Typed into ${describeTarget(element)}.`, {
    previousLength: previous.length,
    newLength: next.length,
  });
}

// ---------------------------------------------------------------------------
// scroll
// ---------------------------------------------------------------------------

/** Find the best scrollable container, or fall back to the page. */
function findScrollContainer(): {
  element: HTMLElement | Window;
  before: number;
  after: number;
} {
  const doc = document.scrollingElement || document.documentElement;
  const rootBefore = window.scrollY;
  const rootMax = doc.scrollHeight - window.innerHeight;

  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      "div, main, section, ul, [role='main'], [style*='overflow']",
    ),
  ).filter((el) => {
    if (!isVisibleNow(el)) return false;
    const style = window.getComputedStyle(el);
    if (!style) return false;
    const overflowY = style.overflowY;
    return (
      (overflowY === "auto" || overflowY === "scroll") &&
      el.scrollHeight > el.clientHeight + 40
    );
  });

  if (candidates.length > 0) {
    // Pick the largest visible scrollable region.
    candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
    const best = candidates[0]!;
    return {
      element: best,
      before: best.scrollTop,
      after: best.scrollHeight - best.clientHeight,
    };
  }

  return { element: window, before: rootBefore, after: rootMax };
}

function runScroll(action: ScrollAction): ActionResult {
  const direction = action.direction;
  let container: {
    element: HTMLElement | Window;
    before: number;
    after: number;
  };

  if (action.target) {
    const check = revalidateElement(action.target);
    if (!check.ok) {
      return fail(
        "scroll",
        check.reason === "detached" ? "TARGET_DETACHED" : "INVALID_TARGET",
        "Unknown scroll target.",
      );
    }
    const el = check.element;
    if (el.scrollHeight <= el.clientHeight) {
      return fail(
        "scroll",
        "UNSUPPORTED_TARGET",
        "Target element is not scrollable.",
      );
    }
    container = {
      element: el,
      before: el.scrollTop,
      after: el.scrollHeight - el.clientHeight,
    };
  } else {
    container = findScrollContainer();
  }

  const viewport = window.innerHeight || 800;
  const amount = action.amount ?? Math.round(viewport * 0.8);

  let targetTop = container.before;
  switch (direction) {
    case "down":
      targetTop = container.before + amount;
      break;
    case "up":
      targetTop = container.before - amount;
      break;
    case "top":
      targetTop = 0;
      break;
    case "bottom":
      targetTop = container.after;
      break;
  }
  targetTop = Math.max(0, Math.min(targetTop, container.after));

  try {
    if (container.element === window) {
      window.scrollTo({ top: targetTop, behavior: "smooth" });
    } else {
      (container.element as HTMLElement).scrollTo({
        top: targetTop,
        behavior: "smooth",
      });
    }
  } catch {
    if (container.element === window) window.scrollTo(0, targetTop);
    else (container.element as HTMLElement).scrollTop = targetTop;
  }

  const scope = container.element === window ? "page" : "container";
  return success("scroll", `Scrolled ${direction} on ${scope}.`, {
    scope,
    from: container.before,
    to: targetTop,
    max: container.after,
    atBottom: targetTop >= container.after - 2,
  });
}

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

function runRead(action: ReadAction): ActionResult {
  if (action.target) {
    const check = revalidateElement(action.target);
    if (!check.ok) {
      return fail(
        "read",
        check.reason === "detached" ? "TARGET_DETACHED" : "INVALID_TARGET",
        check.reason === "detached"
          ? "Target detached; re-scanning."
          : `Unknown target "${action.target}".`,
      );
    }
    const element = check.element;
    try {
      element.scrollIntoView({ block: "center" });
    } catch {
      /* ignore */
    }
    try {
      element.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
    const text = (element.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
    return success("read", `Read ${describeTarget(element)}.`, { text });
  }

  const main =
    document.querySelector<HTMLElement>("main, [role='main'], article") ??
    document.body;
  const text = (main?.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
  return success("read", "Read the main content of the page.", { text });
}

// ---------------------------------------------------------------------------
// navigate (content side: validation only, the background performs it)
// ---------------------------------------------------------------------------

function runNavigate(action: NavigateAction): ActionResult {
  const check = validateUrl(action.url);
  if (!check.ok) {
    return fail(
      "navigate",
      "BLOCKED_URL",
      check.error,
      action.url.slice(0, 200),
    );
  }
  return success(
    "navigate",
    "Navigation validated; handing off to the background worker.",
    {
      url: check.value,
      newTab: action.newTab === true,
    },
  );
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Execute an already-validated action in the current page.
 * Never throws: every failure is returned as a structured result.
 */
export function executeAction(
  action: AgentAction,
  ctx: ActionContext = DEFAULT_ACTION_CONTEXT,
): ActionResult {
  try {
    switch (action.action) {
      case "click":
        return runClick(action, ctx);
      case "type":
        return runType(action, ctx);
      case "scroll":
        return runScroll(action);
      case "navigate":
        return runNavigate(action);
      case "read":
        return runRead(action);
      case "ask_user":
        return success("ask_user", "Question raised for the user.", {
          question: action.question,
        });
      case "done":
        return success("done", "Agent reported completion.");
      default: {
        const exhaustive: never = action;
        return fail(
          undefined,
          "INVALID_ACTION",
          "Unsupported action.",
          JSON.stringify(exhaustive),
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(
      action.action,
      "INTERNAL_ERROR",
      "Action failed unexpectedly.",
      message,
    );
  }
}

/** Convenience: re-read the page right now. */
export function readPage(): ReturnType<typeof scanPage> {
  return scanPage();
}

/** Convenience: check whether an id still points at a live element. */
export function isTargetAlive(id: string): boolean {
  return !!resolveElement(id);
}
