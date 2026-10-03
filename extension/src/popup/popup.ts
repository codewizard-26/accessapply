/**
 * popup.ts - AccessApply main controller UI.
 *
 * Implements the full accessibility-first agent workflow:
 * - Real Session Authentication (Sign In / Register / Sign Out)
 * - Task Command input (Voice or Text)
 * - Discovery Mode with clean interactive job listing (mouse, keyboard 1-9, voice)
 * - Natural Language Job Selection ("first one", "TechNova", "Choose Software Engineer")
 * - Application Confirmation Gate before applying
 * - Automatic Profile Autofill from database
 * - Human-in-the-loop Ask-User card with Voice / Text response
 * - Consequential Action Safety check before submission
 * - Continuous Voice Input Mode with 5 states (ready, listening, processing, off, error)
 * - Text-To-Speech for essential status events
 * - Database-synced Profile management
 * - Meaningful Accessibility preferences (guide, assist, act)
 */

import { MOCK_SCENARIOS } from "../backend.js";
import type {
  ExtensionSettings,
  JobSummaryItem,
  PageContext,
  PendingConfirmation,
  PopupRequest,
  PopupResponse,
  RuntimeSnapshot,
} from "../types.js";

type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : T;

let settingsTouched = false;
let requestCounter = 0;
let lastSpokenText = "";
let currentDiscoveredJobs: JobSummaryItem[] = [];
let voiceActive = false;
let authMode: "login" | "register" = "login";

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

// ---------------------------------------------------------------------------
// DOM Elements Registry
// ---------------------------------------------------------------------------
const dom = {
  // Connection status pill
  connStatusPill: el<HTMLSpanElement>("conn-status-pill"),

  // Auth
  authUserLabel: el<HTMLSpanElement>("auth-user-label"),
  btnAuthToggle: el<HTMLButtonElement>("btn-auth-toggle"),
  authFormPanel: el<HTMLElement>("auth-form-panel"),
  authTabLogin: el<HTMLButtonElement>("auth-tab-login"),
  authTabRegister: el<HTMLButtonElement>("auth-tab-register"),
  authPanelHint: el<HTMLParagraphElement>("auth-panel-hint"),
  authEmail: el<HTMLInputElement>("auth-email"),
  authPassword: el<HTMLInputElement>("auth-password"),
  authConfirmWrap: el<HTMLElement>("auth-confirm-wrap"),
  authPasswordConfirm: el<HTMLInputElement>("auth-password-confirm"),
  btnAuthSubmit: el<HTMLButtonElement>("btn-auth-submit"),
  btnAuthCancel: el<HTMLButtonElement>("btn-auth-cancel"),
  authError: el<HTMLParagraphElement>("auth-error"),

  // Navigation Tabs
  tabBtnAgent: el<HTMLButtonElement>("tab-btn-agent"),
  tabBtnAccess: el<HTMLButtonElement>("tab-btn-access"),
  tabBtnProfile: el<HTMLButtonElement>("tab-btn-profile"),
  tabPaneAgent: el<HTMLElement>("tab-pane-agent"),
  tabPaneAccess: el<HTMLElement>("tab-pane-access"),
  tabPaneProfile: el<HTMLElement>("tab-pane-profile"),

  // Voice & Task Execution
  voiceIndicator: el<HTMLSpanElement>("voice-indicator"),
  taskCommand: el<HTMLTextAreaElement>("task-command"),
  btnStart: el<HTMLButtonElement>("btn-start"),
  btnVoiceToggle: el<HTMLButtonElement>("btn-voice-toggle"),
  btnStop: el<HTMLButtonElement>("btn-stop"),
  voiceStatus: el<HTMLParagraphElement>("voice-status"),

  // Loop & Page Status
  loopStatus: el<HTMLParagraphElement>("loop-status"),
  pageTitle: el<HTMLParagraphElement>("page-title"),
  tabUrl: el<HTMLParagraphElement>("tab-url"),

  // Discovered Jobs Section (Discovery Mode)
  jobsSection: el<HTMLElement>("jobs-section"),
  jobsCountBadge: el<HTMLSpanElement>("jobs-count-badge"),
  jobsList: el<HTMLElement>("jobs-list"),

  // Onboarding Modal (Requirement 1)
  onboardingModal: el<HTMLElement>("onboarding-modal"),
  btnOnboardVoice: el<HTMLButtonElement>("btn-onboard-voice"),
  btnOnboardVk: el<HTMLButtonElement>("btn-onboard-vk"),
  btnOnboardNormal: el<HTMLButtonElement>("btn-onboard-normal"),

  // Virtual Easy Keyboard (Requirement 6)
  virtualKeyboardSection: el<HTMLElement>("virtual-keyboard-section"),
  vkTargetLabel: el<HTMLSpanElement>("vk-target-label"),

  // Interaction Mode & Assistance Mode Radios (Requirement 8)
  modeVoice: el<HTMLInputElement>("mode-voice"),
  modeVirtualKeyboard: el<HTMLInputElement>("mode-virtual-keyboard"),
  modeNormal: el<HTMLInputElement>("mode-normal"),
  assistGuide: el<HTMLInputElement>("assist-guide"),
  assistAssist: el<HTMLInputElement>("assist-assist"),
  assistAct: el<HTMLInputElement>("assist-act"),

  // Human Confirmation Gate
  confirmationSection: el<HTMLElement>("confirmation-section"),
  confirmTitle: el<HTMLElement>("confirm-title"),
  confirmCompanyDetails: el<HTMLParagraphElement>("confirm-company-details"),
  confirmPrompt: el<HTMLParagraphElement>("confirm-prompt"),
  btnConfirmYes: el<HTMLButtonElement>("btn-confirm-yes"),
  btnConfirmNo: el<HTMLButtonElement>("btn-confirm-no"),

  // Ask User Card
  questionSection: el<HTMLElement>("question-section"),
  agentQuestionText: el<HTMLParagraphElement>("agent-question-text"),
  userAnswerInput: el<HTMLInputElement>("user-answer-input"),
  btnVoiceAnswer: el<HTMLButtonElement>("btn-voice-answer"),
  btnSendAnswer: el<HTMLButtonElement>("btn-send-answer"),
  answerVoiceStatus: el<HTMLParagraphElement>("answer-voice-status"),

  // Collapsible Activity Details
  advancedDetails: el<HTMLDetailsElement>("advanced-details"),
  btnScan: el<HTMLButtonElement>("btn-scan"),
  btnClear: el<HTMLButtonElement>("btn-clear"),
  elementCount: el("element-count"),
  jobTitle: el("job-title"),
  health: el("health"),
  log: el<HTMLOListElement>("log"),

  // Accessibility Preferences
  assistanceLevel: el<HTMLSelectElement>("assistance-level"),
  voiceCommands: el<HTMLInputElement>("voice-commands"),
  speechSynthesis: el<HTMLInputElement>("speech-synthesis"),
  simplifiedLanguage: el<HTMLInputElement>("simplified-language"),
  keyboardNav: el<HTMLInputElement>("keyboard-nav"),
  consequential: el<HTMLInputElement>("consequential"),
  highContrast: el<HTMLInputElement>("high-contrast"),
  reducedMotion: el<HTMLInputElement>("reduced-motion"),
  fontSize: el<HTMLSelectElement>("font-size"),
  btnOpenAssistant: el<HTMLButtonElement>("btn-open-assistant"),
  backendUrl: el<HTMLInputElement>("backend-url"),
  maxIterations: el<HTMLInputElement>("max-iterations"),
  mockMode: el<HTMLInputElement>("mock-mode"),
  mockScenario: el<HTMLSelectElement>("mock-scenario"),

  // Application Profile Form
  quickProfileForm: el<HTMLFormElement>("quick-profile-form"),
  profileName: el<HTMLInputElement>("profile-name"),
  profileEmail: el<HTMLInputElement>("profile-email"),
  profilePhone: el<HTMLInputElement>("profile-phone"),
  profileLocation: el<HTMLInputElement>("profile-location"),
  profileSkills: el<HTMLInputElement>("profile-skills"),
  profileLinkedin: el<HTMLInputElement>("profile-linkedin"),
  profileGithub: el<HTMLInputElement>("profile-github"),
  profileResume: el<HTMLInputElement>("profile-resume"),
  btnSaveProfile: el<HTMLButtonElement>("btn-save-profile"),
  btnOpenProfile: el<HTMLButtonElement>("btn-open-profile"),
  btnRefreshProfile: el<HTMLButtonElement>("btn-refresh-profile"),
  profileSaveStatus: el<HTMLParagraphElement>("profile-save-status"),
};

// Fill mock scenario options
for (const scenario of MOCK_SCENARIOS) {
  const option = document.createElement("option");
  option.value = scenario;
  option.textContent = scenario;
  dom.mockScenario.append(option);
}

// ---------------------------------------------------------------------------
// Text-to-Speech (TTS)
// ---------------------------------------------------------------------------

function speak(text: string, force = false): void {
  if (!dom.speechSynthesis.checked) return;
  if (!("speechSynthesis" in window)) return;
  if (!force && text === lastSpokenText) return;

  lastSpokenText = text;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  } catch {
    /* ignore speech synthesis errors */
  }
}

// ---------------------------------------------------------------------------
// Continuous Voice Input Mode & State Management (Requirements 4, 5)
// ---------------------------------------------------------------------------

export type VoiceState =
  | "VOICE_INITIALIZING"
  | "VOICE_LISTENING"
  | "VOICE_PROCESSING"
  | "VOICE_PAUSED"
  | "VOICE_OFF"
  | "VOICE_ERROR";

let currentVoiceState: VoiceState = "VOICE_OFF";

function setVoiceState(state: VoiceState, message?: string): void {
  currentVoiceState = state;
  const pillClass = state.toLowerCase().replace("voice_", "");
  dom.voiceIndicator.className = `voice-state-pill ${pillClass}`;

  switch (state) {
    case "VOICE_INITIALIZING":
      dom.voiceIndicator.textContent = "⏳ Initializing...";
      dom.btnVoiceToggle.classList.remove("listening");
      dom.btnVoiceToggle.textContent = "🎤 Speak";
      dom.voiceStatus.textContent = message || "Voice initializing...";
      break;
    case "VOICE_LISTENING":
      dom.voiceIndicator.textContent = "🔴 Listening...";
      dom.btnVoiceToggle.classList.add("listening");
      dom.btnVoiceToggle.textContent = "⏹ Stop Mic";
      dom.voiceStatus.textContent = message || "Listening for command, choice, or answer...";
      break;
    case "VOICE_PROCESSING":
      dom.voiceIndicator.textContent = "⏳ Processing...";
      dom.btnVoiceToggle.classList.remove("listening");
      dom.voiceStatus.textContent = message || "Processing voice input...";
      break;
    case "VOICE_PAUSED":
      dom.voiceIndicator.textContent = "⏸ Voice Paused";
      dom.btnVoiceToggle.classList.remove("listening");
      dom.btnVoiceToggle.textContent = "🎤 Resume Mic";
      dom.voiceStatus.textContent = message || "Voice paused. Say 'resume' or click to resume.";
      break;
    case "VOICE_OFF":
      dom.voiceIndicator.textContent = "Voice Off";
      dom.btnVoiceToggle.classList.remove("listening");
      dom.btnVoiceToggle.textContent = "🎤 Speak";
      dom.voiceStatus.textContent = message || "Voice commands disabled.";
      break;
    case "VOICE_ERROR":
      dom.voiceIndicator.textContent = "⚠️ Voice Error";
      dom.btnVoiceToggle.classList.remove("listening");
      dom.btnVoiceToggle.textContent = "🎤 Retry Mic";
      dom.voiceStatus.textContent = message || "Voice error. Click to grant microphone permission.";
      break;
  }
}

type SpeechRecognitionInstance = any;
let recognition: SpeechRecognitionInstance = null;

function getSpeechRecognitionClass(): any {
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
}

function initVoiceRecognition(): void {
  const SpeechRec = getSpeechRecognitionClass();
  if (!SpeechRec) {
    setVoiceState("VOICE_OFF", "Speech recognition not supported in this browser.");
    dom.btnVoiceToggle.disabled = true;
    dom.btnVoiceAnswer.disabled = true;
    return;
  }

  if (!dom.voiceCommands.checked && activeInputMode !== "voice") {
    setVoiceState("VOICE_OFF");
    return;
  }

  setVoiceState("VOICE_INITIALIZING");

  try {
    recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      voiceActive = true;
      setVoiceState("VOICE_LISTENING");
    };

    recognition.onresult = (event: any) => {
      const results = event.results;
      const last = results[results.length - 1];
      const transcript = last?.[0]?.transcript?.trim();
      if (!transcript) return;

      setVoiceState("VOICE_PROCESSING", `Heard: "${transcript}"`);
      handleVoiceInput(transcript);
    };

    recognition.onerror = (event: any) => {
      const err = event.error;
      if (err === "not-allowed" || err === "service-not-allowed") {
        setVoiceState("VOICE_ERROR", "Microphone access blocked. Click mic button to enable.");
      } else if (err === "no-speech") {
        if (voiceActive) setVoiceState("VOICE_LISTENING");
      } else {
        setVoiceState("VOICE_ERROR", `Voice notice: ${err}`);
      }
    };

    recognition.onend = () => {
      if (voiceActive && (dom.voiceCommands.checked || activeInputMode === "voice")) {
        setTimeout(() => {
          if (voiceActive && (dom.voiceCommands.checked || activeInputMode === "voice")) {
            try {
              recognition.start();
            } catch {
              /* ignore */
            }
          }
        }, 300);
      } else if (currentVoiceState !== "VOICE_PAUSED") {
        setVoiceState("VOICE_OFF");
      }
    };

    setVoiceState("VOICE_OFF");
  } catch {
    setVoiceState("VOICE_ERROR", "Could not initialize voice module.");
  }
}

function startListening(): void {
  if (!recognition) initVoiceRecognition();
  if (!recognition) return;
  voiceActive = true;
  try {
    recognition.start();
    setVoiceState("VOICE_LISTENING");
  } catch {
    setVoiceState("VOICE_LISTENING");
  }
}

function stopListening(): void {
  voiceActive = false;
  if (recognition) {
    try {
      recognition.stop();
    } catch {
      /* ignore */
    }
  }
  setVoiceState("VOICE_OFF");
}

function toggleListening(): void {
  if (voiceActive) {
    stopListening();
  } else {
    startListening();
  }
}

dom.btnVoiceToggle.addEventListener("click", toggleListening);
dom.voiceIndicator.addEventListener("click", toggleListening);
dom.btnVoiceAnswer.addEventListener("click", () => {
  startListening();
  dom.userAnswerInput.focus();
});

// ---------------------------------------------------------------------------
// Input Mode Management (Requirements 2, 3, 6, 7)
// ---------------------------------------------------------------------------

let activeInputMode: "voice" | "virtual_keyboard" | "normal" = "normal";

function setInputMode(
  mode: "voice" | "virtual_keyboard" | "normal",
  persist = true,
): void {
  activeInputMode = mode;
  dom.modeVoice.checked = mode === "voice";
  dom.modeVirtualKeyboard.checked = mode === "virtual_keyboard";
  dom.modeNormal.checked = mode === "normal";

  if (mode === "virtual_keyboard") {
    dom.virtualKeyboardSection.hidden = false;
    stopListening();
  } else {
    dom.virtualKeyboardSection.hidden = true;
  }

  if (mode === "voice") {
    dom.voiceCommands.checked = true;
    startListening();
  } else if (mode === "normal") {
    stopListening();
  }

  if (persist) {
    void send({
      type: "SAVE_SETTINGS",
      settings: collectSettings(),
    });
  }
}

// ---------------------------------------------------------------------------
// Natural Language Voice Command Router (Requirement 5)
// ---------------------------------------------------------------------------

function handleVoiceInput(transcript: string): void {
  const clean = transcript.toLowerCase();
  dom.voiceStatus.textContent = `Recognized: "${transcript}"`;

  // Control Commands: Pause / Resume / Stop
  if (/\b(pause|pause voice)\b/i.test(clean)) {
    voiceActive = false;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        /* ignore */
      }
    }
    setVoiceState("VOICE_PAUSED");
    speak("Voice paused.");
    return;
  }

  if (/\b(resume|resume voice|start voice)\b/i.test(clean)) {
    speak("Voice resumed.");
    startListening();
    return;
  }

  if (/\b(stop|stop task|abort)\b/i.test(clean)) {
    speak("Stopping.");
    void withBusy(() => send({ type: "STOP_LOOP" }));
    return;
  }

  // 1. Check Confirmation Gate (if currently active)
  if (!dom.confirmationSection.hidden) {
    if (/\b(yes|apply|confirm|proceed|yes apply|do it)\b/i.test(clean)) {
      speak("Applying for job.");
      void confirmApplication();
      return;
    }
    if (/\b(no|cancel|don't apply|dont apply)\b/i.test(clean)) {
      speak("Application cancelled.");
      void cancelApplication();
      return;
    }
  }

  // 2. Check Human-In-The-Loop Ask-User Question (if currently active)
  if (!dom.questionSection.hidden) {
    dom.userAnswerInput.value = transcript;
    speak(`Submitting answer: ${transcript}`);
    void submitAnswer();
    return;
  }

  // 3. Check Discovered Job Selection (if jobs list is displayed)
  if (!dom.jobsSection.hidden && currentDiscoveredJobs.length > 0) {
    const selected = resolveJobSelection(transcript, currentDiscoveredJobs);
    if (selected) {
      speak(`Selected ${selected.title} at ${selected.company || "company"}.`);
      void selectJob(selected);
      return;
    }
  }

  // 4. Voice Profile & View Navigation Commands
  if (/\b(open profile|show profile|view profile|edit my profile|my profile)\b/i.test(clean)) {
    switchTab("profile");
    speak("Opening profile.");
    return;
  }
  if (/\b(save profile|update profile)\b/i.test(clean)) {
    speak("Saving profile.");
    void saveProfileData();
    return;
  }
  if (/\b(open accessibility|accessibility settings|accessibility)\b/i.test(clean)) {
    switchTab("access");
    speak("Opening accessibility preferences.");
    return;
  }
  if (/\b(open agent|back to agent|agent tab)\b/i.test(clean)) {
    switchTab("agent");
    speak("Opening agent.");
    return;
  }

  // 5. Initial Task Command (if on Agent tab and not currently busy)
  if (!dom.tabPaneAgent.hidden) {
    dom.taskCommand.value = transcript;
    if (/\b(find|search|look for|apply|show me|jobs?)\b/i.test(clean)) {
      speak(`Starting search for ${transcript}`);
      void startTask(transcript);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Natural Language Job Selection Resolver
// ---------------------------------------------------------------------------

export function resolveJobSelection(
  input: string,
  jobs: JobSummaryItem[],
): JobSummaryItem | null {
  if (!jobs || jobs.length === 0) return null;
  const cleanInput = input.trim().toLowerCase();

  // 1. Ordinals and number words
  if (/\b(first|1st|one|number 1|number one|that first job)\b/i.test(cleanInput)) return jobs[0] ?? null;
  if (/\b(second|2nd|two|number 2|number two|second job)\b/i.test(cleanInput) && jobs.length > 1) return jobs[1] ?? null;
  if (/\b(third|3rd|three|number 3|number three|third job)\b/i.test(cleanInput) && jobs.length > 2) return jobs[2] ?? null;
  if (/\b(fourth|4th|four|number 4|number four)\b/i.test(cleanInput) && jobs.length > 3) return jobs[3] ?? null;
  if (/\b(fifth|5th|five|number 5|number five)\b/i.test(cleanInput) && jobs.length > 4) return jobs[4] ?? null;

  // 2. Direct digits (e.g. "1", "2")
  const digitMatch = cleanInput.match(/\b([1-9])\b/);
  if (digitMatch && digitMatch[1]) {
    const idx = parseInt(digitMatch[1], 10) - 1;
    if (idx >= 0 && idx < jobs.length) return jobs[idx] ?? null;
  }

  // 3. Match by Company Name
  for (const job of jobs) {
    if (job.company && cleanInput.includes(job.company.toLowerCase())) {
      return job;
    }
  }

  // 4. Match by Title
  for (const job of jobs) {
    const jobTitle = job.title.toLowerCase();
    if (cleanInput.includes(jobTitle)) {
      return job;
    }
    const words = jobTitle.split(/\s+/).filter((w) => w.length > 3);
    if (words.length > 0 && words.every((w) => cleanInput.includes(w))) {
      return job;
    }
  }

  // 5. Significant individual keywords
  for (const job of jobs) {
    const words = job.title.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    for (const w of words) {
      if (cleanInput.includes(w)) return job;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Settings & Styling
// ---------------------------------------------------------------------------

function applyAccessibilityStyles(settings: ExtensionSettings): void {
  document.body.dataset["fontSize"] = settings.fontSize;
  document.body.classList.toggle("high-contrast", settings.highContrast);
  document.body.classList.toggle("reduced-motion", settings.reducedMotion);
}

function fillSettings(settings: ExtensionSettings): void {
  dom.backendUrl.value = settings.backendUrl || "http://localhost:3000";
  dom.mockMode.checked = settings.mockMode;
  dom.mockScenario.value = settings.mockScenario;
  dom.maxIterations.value = String(settings.maxIterations);
  dom.consequential.checked = settings.allowConsequentialActions;
  dom.fontSize.value = settings.fontSize;
  dom.highContrast.checked = settings.highContrast;
  dom.reducedMotion.checked = settings.reducedMotion;
  dom.speechSynthesis.checked = settings.speechSynthesisEnabled;
  dom.voiceCommands.checked = settings.voiceCommandsEnabled;

  if (settings.preferredInputMode) {
    setInputMode(settings.preferredInputMode, false);
  }

  const level = settings.assistanceLevel || "assist";
  dom.assistanceLevel.value = level;
  dom.assistGuide.checked = level === "guide";
  dom.assistAssist.checked = level === "assist";
  dom.assistAct.checked = level === "act";

  dom.simplifiedLanguage.checked = !!settings.plainLanguageMode;
  dom.keyboardNav.checked = !!settings.screenReaderMode;
  applyAccessibilityStyles(settings);
}

function collectSettings(): Partial<ExtensionSettings> {
  return {
    backendUrl: dom.backendUrl.value.trim() || "http://localhost:3000",
    mockMode: dom.mockMode.checked,
    mockScenario: dom.mockScenario.value,
    maxIterations: Number(dom.maxIterations.value) || 15,
    allowConsequentialActions: dom.consequential.checked,
    fontSize: dom.fontSize.value as ExtensionSettings["fontSize"],
    highContrast: dom.highContrast.checked,
    reducedMotion: dom.reducedMotion.checked,
    speechSynthesisEnabled: dom.speechSynthesis.checked,
    voiceCommandsEnabled: dom.voiceCommands.checked,
    assistanceLevel: (dom.assistanceLevel.value as ExtensionSettings["assistanceLevel"]) || "assist",
    preferredInputMode: activeInputMode,
    plainLanguageMode: dom.simplifiedLanguage.checked,
    screenReaderMode: dom.keyboardNav.checked,
  };
}

// ---------------------------------------------------------------------------
// Rendering View State
// ---------------------------------------------------------------------------

function renderSummary(page: PageContext): void {
  dom.pageTitle.textContent = page.title || "(untitled page)";
  dom.tabUrl.textContent = page.url;
  dom.elementCount.textContent = String(page.elements.length);
  const job = page.job;
  dom.jobTitle.textContent = job?.title
    ? [job.title, job.company, job.location, job.employmentType, job.workMode]
        .filter(Boolean)
        .join(" · ")
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

function renderDiscoveredJobs(jobs?: JobSummaryItem[]): void {
  if (!jobs || jobs.length === 0) {
    dom.jobsSection.hidden = true;
    currentDiscoveredJobs = [];
    return;
  }

  currentDiscoveredJobs = jobs;
  dom.jobsSection.hidden = false;
  dom.jobsCountBadge.textContent = `${jobs.length} jobs`;
  dom.jobsList.replaceChildren();

  // Announce discovered jobs once
  speak(`${jobs.length} jobs found. Choose one to view details.`);

  jobs.forEach((job, index) => {
    const item = document.createElement("div");
    item.className = "job-item";
    item.tabIndex = 0;
    item.role = "button";
    item.setAttribute("aria-label", `Job ${index + 1}: ${job.title} at ${job.company || "company"}`);

    const header = document.createElement("div");
    header.className = "job-item-header";

    const badge = document.createElement("span");
    badge.className = "job-index-badge";
    badge.textContent = String(index + 1);

    const titleSpan = document.createElement("span");
    titleSpan.className = "job-title-text";
    titleSpan.textContent = job.title;

    header.append(badge, titleSpan);

    const meta = document.createElement("div");
    meta.className = "job-meta-line";
    meta.textContent = [job.company, job.location, job.salary, job.employmentType]
      .filter(Boolean)
      .join(" · ");

    const actions = document.createElement("div");
    actions.className = "job-actions";

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "primary small btn-select-job";
    selectBtn.textContent = "Select";
    selectBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void selectJob(job);
    });

    actions.append(selectBtn);
    item.append(header, meta, actions);

    item.addEventListener("click", () => void selectJob(job));
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        void selectJob(job);
      }
    });

    dom.jobsList.append(item);
  });
}

function renderConfirmationGate(pending?: PendingConfirmation): void {
  if (!pending) {
    dom.confirmationSection.hidden = true;
    return;
  }

  dom.confirmationSection.hidden = false;
  const job = pending.job;
  dom.confirmTitle.textContent = job?.title || "Application Confirmation";
  dom.confirmCompanyDetails.textContent = [job?.company, job?.location, job?.salary]
    .filter(Boolean)
    .join(" · ");
  dom.confirmPrompt.textContent = pending.message;

  if (pending.type === "apply") {
    dom.btnConfirmYes.textContent = "Yes, Apply";
    speak(
      `You selected ${job?.title || "this job"} at ${job?.company || "the company"}. Would you like me to apply?`,
    );
  } else {
    dom.btnConfirmYes.textContent = "Yes, Submit";
    speak(pending.message);
  }
}

function renderLoop(snapshot: RuntimeSnapshot): void {
  const { loop, contentScriptReady } = snapshot;
  dom.btnStop.disabled = !loop.running;
  dom.btnStart.disabled = loop.running;

  // Render Discovered Jobs
  renderDiscoveredJobs(loop.discoveredJobs);

  // Render Confirmation Gate
  renderConfirmationGate(loop.pendingConfirmation);

  // Render Ask-User Question Card
  if (loop.status === "waiting_for_user" && loop.pendingQuestion) {
    dom.questionSection.hidden = false;
    dom.agentQuestionText.textContent = loop.pendingQuestion;
    dom.loopStatus.textContent = "Waiting for your response...";
    dom.loopStatus.style.background = "rgba(255, 170, 0, 0.2)";
    dom.loopStatus.style.color = "#d97706";

    speak(`Question from AccessApply: ${loop.pendingQuestion}`);
    dom.userAnswerInput.focus();
  } else {
    dom.questionSection.hidden = true;
    if (loop.running) {
      dom.loopStatus.textContent = `Running - iteration ${loop.iteration} of ${loop.maxIterations}`;
      dom.loopStatus.style.background = "rgba(27, 77, 216, 0.15)";
      dom.loopStatus.style.color = "var(--accent)";
    } else if (loop.status === "completed") {
      dom.loopStatus.textContent = "Completed - application finished!";
      dom.loopStatus.style.background = "rgba(23, 96, 58, 0.15)";
      dom.loopStatus.style.color = "var(--success)";
      speak("Application submitted successfully.");
    } else if (loop.stoppedReason) {
      dom.loopStatus.textContent = `Idle - ${loop.stoppedReason}`;
      dom.loopStatus.style.background = "rgba(100, 100, 100, 0.1)";
      dom.loopStatus.style.color = "var(--fg)";
    } else {
      dom.loopStatus.textContent = contentScriptReady
        ? "Idle - ready."
        : "Idle - navigate to a job page to start.";
      dom.loopStatus.style.background = "rgba(100, 100, 100, 0.1)";
      dom.loopStatus.style.color = "var(--fg)";
    }
  }
}

function renderAuth(snapshot: RuntimeSnapshot): void {
  const auth = snapshot.auth;
  if (auth && auth.authenticated && auth.user) {
    dom.authUserLabel.textContent = `Signed in: ${auth.user.email}`;
    dom.authUserLabel.className = "small";
    dom.btnAuthToggle.textContent = "Sign Out";
    dom.authFormPanel.hidden = true;
  } else {
    dom.authUserLabel.textContent = "Not signed in";
    dom.authUserLabel.className = "small muted";
    dom.btnAuthToggle.textContent = "Sign In";
  }
}

async function refresh(): Promise<RuntimeSnapshot | undefined> {
  const response = await send<RuntimeSnapshot>({ type: "GET_SNAPSHOT" });
  if (!response.ok || !response.data) {
    dom.loopStatus.textContent =
      response.error?.message ?? "Connecting to AccessApply service worker...";
    return undefined;
  }
  const snapshot = response.data;
  if (!settingsTouched) fillSettings(snapshot.settings);
  if (snapshot.lastPage) renderSummary(snapshot.lastPage);
  renderAuth(snapshot);
  renderLoop(snapshot);
  renderLogs(snapshot);
  return snapshot;
}

async function withBusy<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } finally {
    await refresh();
  }
}

// ---------------------------------------------------------------------------
// Actions: Start Task, Select Job, Confirm, Cancel, Answer
// ---------------------------------------------------------------------------

async function startTask(commandOverride?: string): Promise<void> {
  await withBusy(async () => {
    const command = (commandOverride || dom.taskCommand.value).trim();
    if (!command) {
      dom.loopStatus.textContent = "Please enter or speak a task command.";
      return;
    }
    const profile = cachedProfile || undefined;
    await send({ type: "START_TASK", command, userProfile: profile });
  });
}

async function selectJob(job: JobSummaryItem): Promise<void> {
  await withBusy(async () => {
    await send({ type: "SELECT_JOB", job });
  });
}

async function confirmApplication(): Promise<void> {
  await withBusy(async () => {
    await send({ type: "CONFIRM_APPLICATION" });
  });
}

async function cancelApplication(): Promise<void> {
  await withBusy(async () => {
    await send({ type: "CANCEL_APPLICATION" });
  });
}

async function submitAnswer(): Promise<void> {
  const answer = dom.userAnswerInput.value.trim();
  if (!answer) {
    dom.answerVoiceStatus.textContent = "Please provide an answer.";
    return;
  }
  dom.btnSendAnswer.disabled = true;
  dom.answerVoiceStatus.textContent = "Submitting answer to agent...";
  try {
    const res = await send({ type: "RESPOND_TO_TASK", answer });
    if (res.ok) {
      dom.userAnswerInput.value = "";
      dom.questionSection.hidden = true;
      dom.answerVoiceStatus.textContent = "";
      speak("Answer submitted. Continuing application.");
    } else {
      dom.answerVoiceStatus.textContent = res.error?.message || "Failed to send answer.";
    }
  } finally {
    dom.btnSendAnswer.disabled = false;
    await refresh();
  }
}

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

// Task Controls
dom.btnStart.addEventListener("click", () => void startTask());
dom.btnStop.addEventListener("click", () => void withBusy(() => send({ type: "STOP_LOOP" })));
dom.btnScan.addEventListener("click", () =>
  void withBusy(async () => {
    const response = await send<{ page: PageContext }>({ type: "SCAN_ACTIVE_TAB" });
    if (response.ok && response.data) {
      renderSummary(response.data.page);
    }
  }),
);

// Confirmation Gate Buttons
dom.btnConfirmYes.addEventListener("click", () => void confirmApplication());
dom.btnConfirmNo.addEventListener("click", () => void cancelApplication());

// Answer Card Buttons
dom.btnSendAnswer.addEventListener("click", () => void submitAnswer());
dom.userAnswerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    void submitAnswer();
  }
});

// Keyboard Navigation for Job Selection (Keys 1-9)
window.addEventListener("keydown", (e) => {
  if (
    document.activeElement?.tagName === "INPUT" ||
    document.activeElement?.tagName === "TEXTAREA"
  ) {
    return;
  }
  if (!dom.jobsSection.hidden && currentDiscoveredJobs.length > 0) {
    const num = parseInt(e.key, 10);
    if (!isNaN(num) && num >= 1 && num <= currentDiscoveredJobs.length) {
      e.preventDefault();
      const job = currentDiscoveredJobs[num - 1];
      if (job) {
        speak(`Selected job ${num}: ${job.title}`);
        void selectJob(job);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Authentication Flow (Sign In / Register)
// ---------------------------------------------------------------------------

function setAuthMode(mode: "login" | "register"): void {
  authMode = mode;
  const isLogin = mode === "login";
  dom.authTabLogin.style.background = isLogin ? "var(--bg-active)" : "transparent";
  dom.authTabRegister.style.background = !isLogin ? "var(--bg-active)" : "transparent";
  dom.authConfirmWrap.hidden = isLogin;
  dom.btnAuthSubmit.textContent = isLogin ? "Sign In" : "Create Account";
  dom.authPanelHint.textContent = isLogin
    ? "Enter your email and password to access your profile and tasks."
    : "Create a new AccessApply account to sync your profile across devices.";
  dom.authError.hidden = true;
}

dom.authTabLogin.addEventListener("click", () => setAuthMode("login"));
dom.authTabRegister.addEventListener("click", () => setAuthMode("register"));

dom.btnAuthToggle.addEventListener("click", async () => {
  if (dom.btnAuthToggle.textContent === "Sign Out") {
    await send({ type: "LOGOUT" });
    await refresh();
  } else {
    dom.authFormPanel.hidden = !dom.authFormPanel.hidden;
    if (!dom.authFormPanel.hidden) {
      setAuthMode("login");
      dom.authEmail.focus();
    }
  }
});

dom.btnAuthCancel.addEventListener("click", () => {
  dom.authFormPanel.hidden = true;
  dom.authError.hidden = true;
});

dom.btnAuthSubmit.addEventListener("click", async () => {
  const email = dom.authEmail.value.trim();
  const password = dom.authPassword.value;

  if (!email || !password) {
    dom.authError.textContent = "Email and password are required.";
    dom.authError.hidden = false;
    return;
  }

  if (authMode === "register") {
    const confirm = dom.authPasswordConfirm.value;
    if (password !== confirm) {
      dom.authError.textContent = "Passwords do not match.";
      dom.authError.hidden = false;
      return;
    }
    if (password.length < 6) {
      dom.authError.textContent = "Password must be at least 6 characters long.";
      dom.authError.hidden = false;
      return;
    }
  }

  dom.authError.hidden = true;
  dom.btnAuthSubmit.disabled = true;
  dom.btnAuthSubmit.textContent = "Processing...";

  try {
    const type = authMode === "login" ? "LOGIN" : "REGISTER";
    const res = await send({ type, email, password });
    if (res.ok) {
      dom.authFormPanel.hidden = true;
      dom.authPassword.value = "";
      dom.authPasswordConfirm.value = "";
      speak(authMode === "login" ? "Signed in successfully." : "Account created successfully.");
      await refresh();
      void loadProfileData();
    } else {
      dom.authError.textContent = res.error?.message || "Authentication failed.";
      dom.authError.hidden = false;
    }
  } finally {
    dom.btnAuthSubmit.disabled = false;
    dom.btnAuthSubmit.textContent = authMode === "login" ? "Sign In" : "Create Account";
  }
});

// ---------------------------------------------------------------------------
// Tabs & Multi-View Navigation
// ---------------------------------------------------------------------------

function switchTab(tab: "agent" | "access" | "profile"): void {
  const isAgent = tab === "agent";
  const isAccess = tab === "access";
  const isProfile = tab === "profile";

  dom.tabBtnAgent.classList.toggle("active", isAgent);
  dom.tabBtnAccess.classList.toggle("active", isAccess);
  dom.tabBtnProfile.classList.toggle("active", isProfile);

  dom.tabBtnAgent.setAttribute("aria-selected", String(isAgent));
  dom.tabBtnAccess.setAttribute("aria-selected", String(isAccess));
  dom.tabBtnProfile.setAttribute("aria-selected", String(isProfile));

  dom.tabPaneAgent.hidden = !isAgent;
  dom.tabPaneAccess.hidden = !isAccess;
  dom.tabPaneProfile.hidden = !isProfile;

  if (isProfile) {
    void loadProfileData();
  }
}

dom.tabBtnAgent.addEventListener("click", () => switchTab("agent"));
dom.tabBtnAccess.addEventListener("click", () => switchTab("access"));
dom.tabBtnProfile.addEventListener("click", () => switchTab("profile"));

// ---------------------------------------------------------------------------
// Profile Management & Database Sync
// ---------------------------------------------------------------------------

interface StoredProfile {
  [key: string]: unknown;
  name: string;
  email: string;
  phone?: string;
  location?: string;
  skills?: string[];
  links?: { linkedin?: string; github?: string };
  resumeUrl?: string;
  education?: unknown[];
  experience?: unknown[];
  accessibilityPreferences?: Record<string, unknown>;
}

let cachedProfile: StoredProfile | null = null;

function populateProfileForm(profile: StoredProfile): void {
  dom.profileName.value = profile.name || "";
  dom.profileEmail.value = profile.email || "";
  dom.profilePhone.value = profile.phone || "";
  dom.profileLocation.value = profile.location || "";
  dom.profileSkills.value = Array.isArray(profile.skills) ? profile.skills.join(", ") : "";
  dom.profileLinkedin.value = profile.links?.linkedin || "";
  dom.profileGithub.value = profile.links?.github || "";
  dom.profileResume.value = profile.resumeUrl || "";
}

async function loadProfileData(): Promise<void> {
  dom.profileSaveStatus.textContent = "Loading profile...";
  dom.profileSaveStatus.style.color = "var(--muted)";

  const res = await send<StoredProfile>({ type: "GET_PROFILE" });
  if (res.ok && res.data && (res.data.name || res.data.email)) {
    cachedProfile = res.data;
    populateProfileForm(res.data);
    dom.profileSaveStatus.textContent = "Profile synced from account database.";
    dom.profileSaveStatus.style.color = "var(--success)";
    return;
  }

  dom.profileSaveStatus.textContent = "No profile saved yet. Enter details above.";
  dom.profileSaveStatus.style.color = "var(--muted)";
}

async function saveProfileData(): Promise<void> {
  const name = dom.profileName.value.trim();
  const email = dom.profileEmail.value.trim();

  if (!name || !email) {
    dom.profileSaveStatus.textContent = "Name and email are required.";
    dom.profileSaveStatus.style.color = "#dc2626";
    return;
  }

  dom.profileSaveStatus.textContent = "Saving profile...";
  dom.profileSaveStatus.style.color = "var(--muted)";

  const phone = dom.profilePhone.value.trim() || undefined;
  const location = dom.profileLocation.value.trim() || undefined;
  const rawSkills = dom.profileSkills.value;
  const skills = rawSkills
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const linkedin = dom.profileLinkedin.value.trim() || undefined;
  const github = dom.profileGithub.value.trim() || undefined;
  const resumeUrl = dom.profileResume.value.trim() || undefined;

  const profilePayload: StoredProfile = {
    name,
    email,
    phone,
    location,
    skills,
    links: { linkedin, github },
    resumeUrl,
    education: cachedProfile?.education || [],
    experience: cachedProfile?.experience || [],
    accessibilityPreferences: cachedProfile?.accessibilityPreferences || {
      assistanceLevel: dom.assistanceLevel.value,
      highContrast: dom.highContrast.checked,
      reducedMotion: dom.reducedMotion.checked,
      simplifiedText: dom.simplifiedLanguage.checked,
      keyboardNavigation: dom.keyboardNav.checked,
      voiceEnabled: dom.voiceCommands.checked,
      textToSpeechEnabled: dom.speechSynthesis.checked,
    },
  };

  cachedProfile = profilePayload;
  const res = await send({ type: "SAVE_PROFILE", profile: profilePayload });
  if (res.ok) {
    dom.profileSaveStatus.textContent = "Profile saved & synced with database!";
    dom.profileSaveStatus.style.color = "var(--success)";
    speak("Profile saved and synced successfully.");
  } else {
    dom.profileSaveStatus.textContent = "Profile saved locally.";
    dom.profileSaveStatus.style.color = "#d97706";
  }
}

dom.btnSaveProfile.addEventListener("click", () => void saveProfileData());
dom.btnRefreshProfile.addEventListener("click", () => void loadProfileData());

// Workspace Studio Shortcuts
dom.btnOpenProfile.addEventListener("click", () => {
  const url = chrome.runtime.getURL("profile-ui/index.html");
  chrome.tabs.create({ url });
});
dom.btnOpenAssistant.addEventListener("click", () => {
  const url = chrome.runtime.getURL("accessibility-ui/index.html");
  chrome.tabs.create({ url });
});
dom.btnClear.addEventListener("click", () => void withBusy(() => send({ type: "CLEAR_LOGS" })));

// ---------------------------------------------------------------------------
// Settings Change Listeners
// ---------------------------------------------------------------------------

dom.backendUrl.addEventListener("input", () => {
  settingsTouched = true;
});

for (const input of [
  dom.backendUrl,
  dom.consequential,
  dom.voiceCommands,
  dom.speechSynthesis,
  dom.mockMode,
  dom.mockScenario,
  dom.maxIterations,
  dom.fontSize,
  dom.highContrast,
  dom.reducedMotion,
  dom.assistanceLevel,
  dom.simplifiedLanguage,
  dom.keyboardNav,
]) {
  input.addEventListener("change", async () => {
    const response = await send<ExtensionSettings>({
      type: "SAVE_SETTINGS",
      settings: collectSettings(),
    });
    if (response.ok && response.data) {
      applyAccessibilityStyles(response.data);
    }
    await refresh();
    await checkBackendHealth();
  });
}

// ---------------------------------------------------------------------------
// Onboarding & Interaction Mode Setup (Requirements 1, 3, 6, 8, 29)
// ---------------------------------------------------------------------------

function initVirtualKeyboard(): void {
  const keys = dom.virtualKeyboardSection.querySelectorAll<HTMLButtonElement>(".vk-key");
  keys.forEach((btn) => {
    btn.addEventListener("click", () => {
      const isQuestionActive = !dom.questionSection.hidden;
      const targetInput: HTMLInputElement | HTMLTextAreaElement = isQuestionActive
        ? dom.userAnswerInput
        : dom.taskCommand;
      dom.vkTargetLabel.textContent = isQuestionActive ? "Agent Question" : "Task Command";

      const key = btn.dataset["key"];
      const action = btn.dataset["action"];

      if (key) {
        targetInput.value += key.toLowerCase();
        targetInput.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (action === "space") {
        targetInput.value += " ";
        targetInput.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (action === "backspace") {
        targetInput.value = targetInput.value.slice(0, -1);
        targetInput.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (action === "enter") {
        if (isQuestionActive) {
          void submitAnswer();
        } else {
          void startTask();
        }
      } else if (action === "speak") {
        toggleListening();
      }
    });
  });
}

function checkOnboarding(settings: ExtensionSettings): void {
  if (!settings.preferredInputMode) {
    dom.onboardingModal.hidden = false;
    speak("Welcome to AccessApply. How would you like to use AccessApply?");
  } else {
    dom.onboardingModal.hidden = true;
    setInputMode(settings.preferredInputMode, false);
  }
}

async function checkActiveTabStatus(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    const url = tab?.url || "";
    if (
      url.startsWith("chrome://") ||
      url.startsWith("edge://") ||
      url.startsWith("chrome-extension://") ||
      url.includes("chrome.google.com/webstore") ||
      url.includes("chromewebstore.google.com")
    ) {
      dom.loopStatus.textContent =
        "AccessApply can't interact with this browser page. Open a normal webpage to continue.";
      dom.loopStatus.style.background = "rgba(179, 38, 30, 0.1)";
      dom.loopStatus.style.color = "var(--error)";
      dom.btnStart.disabled = true;
    }
  } catch {
    /* ignore */
  }
}

// Onboarding Modal Choices
dom.btnOnboardVoice.addEventListener("click", () => {
  dom.onboardingModal.hidden = true;
  setInputMode("voice", true);
  speak("Voice commands selected.");
});

dom.btnOnboardVk.addEventListener("click", () => {
  dom.onboardingModal.hidden = true;
  setInputMode("virtual_keyboard", true);
  speak("Virtual Easy Keyboard selected.");
});

dom.btnOnboardNormal.addEventListener("click", () => {
  dom.onboardingModal.hidden = true;
  setInputMode("normal", true);
  speak("Normal controls selected.");
});

// Interaction Mode & Assistance Radios
dom.modeVoice.addEventListener("change", () => setInputMode("voice", true));
dom.modeVirtualKeyboard.addEventListener("change", () =>
  setInputMode("virtual_keyboard", true),
);
dom.modeNormal.addEventListener("change", () => setInputMode("normal", true));

dom.assistGuide.addEventListener("change", () => {
  dom.assistanceLevel.value = "guide";
  dom.assistanceLevel.dispatchEvent(new Event("change"));
});
dom.assistAssist.addEventListener("change", () => {
  dom.assistanceLevel.value = "assist";
  dom.assistanceLevel.dispatchEvent(new Event("change"));
});
dom.assistAct.addEventListener("change", () => {
  dom.assistanceLevel.value = "act";
  dom.assistanceLevel.dispatchEvent(new Event("change"));
});

// ---------------------------------------------------------------------------
// Backend Status Detection
// ---------------------------------------------------------------------------

async function checkBackendHealth(): Promise<void> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "CHECK_HEALTH",
    })) as { ok: boolean; detail: string } | undefined;

    if (response && response.ok) {
      dom.connStatusPill.textContent = "● Connected";
      dom.connStatusPill.className = "conn-pill online";
      dom.health.textContent = "online (connected)";
    } else {
      dom.connStatusPill.textContent = "● Offline";
      dom.connStatusPill.className = "conn-pill offline";
      dom.health.textContent = "offline";
    }
  } catch {
    dom.connStatusPill.textContent = "● Offline";
    dom.connStatusPill.className = "conn-pill offline";
    dom.health.textContent = "offline";
  }
}

// ---------------------------------------------------------------------------
// Polling Loop & Initialization
// ---------------------------------------------------------------------------

let pollInterval: number | undefined;
function schedulePoll(): void {
  if (pollInterval !== undefined) clearInterval(pollInterval);
  pollInterval = window.setInterval(() => void refresh(), 1000);
}

void (async () => {
  initVoiceRecognition();
  initVirtualKeyboard();
  await send({ type: "CHECK_AUTH" });
  const snap = await refresh();
  if (snap?.settings) {
    checkOnboarding(snap.settings);
  }
  await checkBackendHealth();
  await checkActiveTabStatus();
  void loadProfileData();
  schedulePoll();
})();
