/**
 * AccessApply Extension - shared typed contracts.
 *
 * These types define the contract between the extension and the backend.
 * They are intentionally a superset-compatible extension of the repository
 * level contracts in `shared/types/` (AgentAction / PageContext / PageElement):
 * the fields defined there are preserved verbatim so a backend that already
 * targets `shared/types` continues to work, while extra fields are optional.
 */

// ---------------------------------------------------------------------------
// Page context
// ---------------------------------------------------------------------------

export type ElementType =
  | "button"
  | "input"
  | "textarea"
  | "select"
  | "link"
  | "heading"
  | "text"
  | "checkbox"
  | "radio"
  | "option"
  | "listitem"
  | "form"
  | "other";

/** Single actionable / notable element extracted from the page. */
export interface PageElement {
  /** Stable id for this page scan, e.g. "el_1". */
  id: string;
  type: ElementType;
  /** Visible text content (trimmed, collapsed). */
  text?: string;
  /** Associated label text for form controls. */
  label?: string;
  placeholder?: string;
  /**
   * Current value. Never populated for password inputs or any input whose
   * type is sensitive, to avoid leaking credentials to the backend.
   */
  value?: string;

  // ---- extensions over shared/types/page-context.ts ----
  /** DOM tag name, lowercase. */
  tag?: string;
  /** Explicit or computed ARIA role. */
  role?: string;
  /** Accessible name as computed from aria-label / label / content. */
  accessibleName?: string;
  /** aria-label value verbatim. */
  ariaLabel?: string;
  /** id attribute of the associated <label for="...">, if any. */
  labelFor?: string;
  /** type attribute of an <input>. */
  inputType?: string;
  /** href for links, resolved to an absolute URL. */
  href?: string;
  /** True when the control cannot currently be interacted with. */
  disabled?: boolean;
  /** required attribute or aria-required="true". */
  required?: boolean;
  /** aria-expanded state, for expandable controls. */
  expanded?: boolean;
  /** Options for <select>. */
  options?: string[];
  /** Number-level value for sliders / spinbuttons / progress. */
  valueNow?: number;
  valueMin?: number;
  valueMax?: number;
  /** Level 1-6 for headings. */
  level?: number;
  /** Logical ordering index as it appears in the accessibility tree. */
  order?: number;
}

export interface JobInfo {
  title?: string;
  company?: string;
  location?: string;
  /** e.g. "Full-time", "Part-time", "Contract". */
  employmentType?: string;
  /** "remote" | "hybrid" | "onsite" | "unknown". */
  workMode?: "remote" | "hybrid" | "onsite" | "unknown";
  salary?: string;
  description?: string;
  requirements?: string[];
  /** Free text application instructions found on the page. */
  applicationInstructions?: string;
  applyUrl?: string;
}

/** Structured, screen-reader-friendly snapshot of the active page. */
export interface PageContext {
  url: string;
  title: string;
  /** Concatenated meaningful visible text (headings + body prose). */
  text: string;
  elements: PageElement[];
  job?: JobInfo;
  /** When the scan happened (epoch ms). */
  scannedAt?: number;
  /** Focusable element id, if the page sets a meaningful initial focus. */
  focusedElementId?: string;
  /** True when the document is still loading. */
  loading?: boolean;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type ScrollDirection = "up" | "down" | "top" | "bottom";

export interface ClickAction {
  action: "click";
  target: string;
  /** Optional human readable intent, for logging only. */
  reason?: string;
  /**
   * Set by the extension (not the backend) when the user explicitly approved
   * a consequential action such as submitting an application.
   */
  userAuthorized?: boolean;
}

export interface TypeAction {
  action: "type";
  target: string;
  value: string;
  /** Append instead of replacing existing value. Default: false (replace). */
  append?: boolean;
  /** Dispatch blur after typing. Default: true. */
  blur?: boolean;
  reason?: string;
  userAuthorized?: boolean;
}

export interface ScrollAction {
  action: "scroll";
  direction: ScrollDirection;
  /** Optional explicit scroll container id; defaults to best candidate. */
  target?: string;
  /** Pixels to scroll; defaults to ~80% of viewport height. */
  amount?: number;
  reason?: string;
}

export interface NavigateAction {
  action: "navigate";
  url: string;
  /** Open in a new tab instead of the current tab. Default: false. */
  newTab?: boolean;
  reason?: string;
}

export interface ReadAction {
  action: "read";
  /** Optional element id to focus the read on. */
  target?: string;
  reason?: string;
}

export interface AskUserAction {
  action: "ask_user";
  question: string;
  reason?: string;
}

export interface DoneAction {
  action: "done";
  reason?: string;
}

/**
 * Action shape accepted from the backend. Note this mirrors
 * `shared/types/actions.ts` with the scroll direction widened and optional
 * metadata added, so both encodings validate.
 */
export type AgentAction =
  | ClickAction
  | TypeAction
  | ScrollAction
  | NavigateAction
  | ReadAction
  | AskUserAction
  | DoneAction;

// ---------------------------------------------------------------------------
// Action responses
// ---------------------------------------------------------------------------

export type ActionErrorCode =
  | "INVALID_ACTION"
  | "INVALID_TARGET"
  | "TARGET_DETACHED"
  | "TARGET_HIDDEN"
  | "TARGET_DISABLED"
  | "TARGET_NOT_EDITABLE"
  | "UNSUPPORTED_TARGET"
  | "BLOCKED_URL"
  | "REQUIRES_AUTHORIZATION"
  | "CONSEQUENTIAL_ACTION"
  | "TIMEOUT"
  | "PAGE_CHANGED"
  | "BACKEND_ERROR"
  | "BACKEND_UNAVAILABLE"
  | "INVALID_BACKEND_RESPONSE"
  | "ITERATION_LIMIT"
  | "REPEATED_FAILURE"
  | "CANCELLED"
  | "INTERNAL_ERROR";

export interface ActionError {
  code: ActionErrorCode;
  message: string;
  /** Optional extra detail for debugging. Never contains sensitive values. */
  detail?: string;
}

export interface ActionSuccessResult {
  ok: true;
  action: AgentAction["action"];
  /** Page context re-read after the action, when available. */
  page?: PageContext;
  message: string;
  /** Extra data such as scroll coordinates. */
  data?: Record<string, unknown>;
}

export interface ActionFailureResult {
  ok: false;
  action?: AgentAction["action"];
  error: ActionError;
  /** Page context after the failed attempt, so the agent can recover. */
  page?: PageContext;
}

export type ActionResult = ActionSuccessResult | ActionFailureResult;

// ---------------------------------------------------------------------------
// Extension messaging (popup <-> background <-> content)
// ---------------------------------------------------------------------------

export interface OverlayState {
  visible: boolean;
  statusText?: string;
  discoveredJobs?: JobSummaryItem[];
  selectedJob?: JobSummaryItem;
  pendingConfirmation?: PendingConfirmation;
  pendingQuestion?: string;
  voiceState?: string;
  voiceStatus?: string;
  completed?: boolean;
}

export type ToContentMessage =
  | { type: "SCAN_PAGE"; tabId?: number }
  | { type: "EXECUTE_ACTION"; action: AgentAction }
  | { type: "GET_STATE" }
  | { type: "UPDATE_OVERLAY"; state: OverlayState };

export interface ContentScanResponse {
  ok: boolean;
  page?: PageContext;
  error?: ActionError;
}

export interface ContentActionResponse {
  ok: boolean;
  result?: ActionResult;
  error?: ActionError;
}

export interface ContentOverlayResponse {
  ok: boolean;
}

export type ContentMessage = ToContentMessage;

export type PopupMessage =
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: Partial<ExtensionSettings> }
  | { type: "SCAN_ACTIVE_TAB" }
  | { type: "RUN_STEP" }
  | { type: "START_LOOP" }
  | { type: "STOP_LOOP" }
  | { type: "GET_LOGS" }
  | { type: "CLEAR_LOGS" }
  | { type: "PING" };

export interface ExtensionSettings {
  /** Base URL of the AccessApply backend, e.g. "http://localhost:5000". */
  backendUrl: string;
  /** Route used to POST the page context and receive the next action. */
  nextActionPath: string;
  /** Route used for a lightweight health check. */
  healthPath: string;
  /** When true the extension never touches the network. */
  mockMode: boolean;
  /** Mock scenario selector. See backend.ts for available values. */
  mockScenario: string;
  /** Maximum agent-loop iterations per run. */
  maxIterations: number;
  /** Milliseconds to wait for the page to settle after an action. */
  waitAfterActionMs: number;
  /** Maximum milliseconds to wait for the page to settle. */
  pageSettleTimeoutMs: number;
  /** Allow the extension to perform consequential actions after user approval. */
  allowConsequentialActions: boolean;
  /** Text size selected in the popup. */
  fontSize: "normal" | "large" | "x-large";
  /** Apply a high-contrast visual theme to the popup and scanned page. */
  highContrast: boolean;
  /** Reduce animation and motion effects. */
  reducedMotion: boolean;
  /** Enable text-to-speech for status updates. */
  speechSynthesisEnabled: boolean;
  /** Enable voice command parsing. */
  voiceCommandsEnabled: boolean;
  /** Prefer screen-reader-friendly summaries and cues. */
  screenReaderMode: boolean;
  /** Show simplified plain-language summaries. */
  plainLanguageMode: boolean;
  /** Announce job summaries automatically. */
  autoSpeakSummaries: boolean;
  /** Extra host origins the extension may navigate to / read. */
  allowedOrigins: string[];
  /** Mode of assistance: step-by-step guidance, interactive assistance, or autonomous execution. */
  assistanceLevel?: "guide" | "assist" | "act";
  /** Primary user interaction mode: voice recognition, accessible on-screen keyboard, or normal mouse/keyboard. */
  preferredInputMode?: "voice" | "virtual_keyboard" | "normal";
}

export interface AgentLogEntry {
  /** Monotonic-ish index for rendering. */
  seq: number;
  ts: number;
  level: "info" | "warn" | "error" | "success";
  message: string;
  data?: unknown;
}

export type AgentTaskStatus = "running" | "waiting_for_user" | "completed" | "failed";

export interface AgentTask {
  id: string;
  userId: string;
  command: string;
  status: AgentTaskStatus;
  currentUrl?: string | null;
  lastAction?: AgentAction | null;
  lastQuestion?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface JobSummaryItem {
  id: string;
  title: string;
  company?: string;
  location?: string;
  salary?: string;
  employmentType?: string;
  targetId?: string;
  url?: string;
}

export interface PendingConfirmation {
  type: "apply" | "submit";
  job?: JobSummaryItem;
  message: string;
  targetAction?: AgentAction;
}

export interface AgentLoopState {
  running: boolean;
  iteration: number;
  maxIterations: number;
  taskId?: string;
  command?: string;
  pendingQuestion?: string;
  status?: AgentTaskStatus;
  startedAt?: number;
  lastAction?: AgentAction;
  lastResult?: ActionResult;
  lastError?: ActionError;
  consecutiveFailures: number;
  stoppedReason?: string;
  discoveredJobs?: JobSummaryItem[];
  selectedJob?: JobSummaryItem;
  pendingConfirmation?: PendingConfirmation;
}

export interface RuntimeSnapshot {
  settings: ExtensionSettings;
  loop: AgentLoopState;
  lastPage?: PageContext;
  logs: AgentLogEntry[];
  /** True when a supported content script is present on the active tab. */
  contentScriptReady: boolean;
  tabId?: number;
  tabUrl?: string;
  auth?: {
    authenticated: boolean;
    user?: { id: string; email: string };
  };
  profile?: Record<string, unknown>;
}

export interface PopupResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: ActionError;
}

// ---------------------------------------------------------------------------
// Message envelope used between popup and the service worker
// ---------------------------------------------------------------------------

export type PopupRequest =
  | { id: string; type: "GET_SNAPSHOT" }
  | { id: string; type: "SCAN_ACTIVE_TAB" }
  | { id: string; type: "START_TASK"; command?: string; userProfile?: Record<string, unknown> }
  | { id: string; type: "RESPOND_TO_TASK"; answer: string }
  | { id: string; type: "RUN_MOCK_ACTION"; action: AgentAction }
  | { id: string; type: "SAVE_SETTINGS"; settings: Partial<ExtensionSettings> }
  | { id: string; type: "START_LOOP" }
  | { id: string; type: "STOP_LOOP" }
  | { id: string; type: "CLEAR_LOGS" }
  | { id: string; type: "CHECK_AUTH" }
  | { id: string; type: "LOGIN"; email: string; password: string }
  | { id: string; type: "REGISTER"; email: string; password: string }
  | { id: string; type: "LOGOUT" }
  | { id: string; type: "GET_PROFILE" }
  | { id: string; type: "SAVE_PROFILE"; profile: Record<string, unknown> }
  | { id: string; type: "SELECT_JOB"; job: JobSummaryItem }
  | { id: string; type: "CONFIRM_APPLICATION" }
  | { id: string; type: "CANCEL_APPLICATION" };

/** Summary form of a scan, cheap enough to render in the popup. */
export interface PageSummary {
  url: string;
  title: string;
  elementCount: number;
  job?: JobInfo;
  textPreview: string;
}
