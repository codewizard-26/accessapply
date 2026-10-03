/**
 * overlay.ts - Lightweight, accessible in-page AccessApply Assistant overlay.
 *
 * Injected into the active page via Shadow DOM to guarantee style isolation.
 * Displays real-time discovery jobs, confirmation gate, questions, and voice status.
 */

import type { OverlayState } from "./types.js";

let overlayHost: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let isMinimized = false;
let currentState: OverlayState = { visible: false };

const OVERLAY_CSS = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.4;
  color: #1e293b;
}

.accessapply-overlay-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 2147483647;
  width: 360px;
  max-width: calc(100vw - 40px);
  background: #ffffff;
  border: 2px solid #2563eb;
  border-radius: 12px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.overlay-header {
  background: #2563eb;
  color: #ffffff;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  user-select: none;
}

.overlay-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.02em;
}

.overlay-status-pill {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.25);
  font-weight: 600;
}

.overlay-controls {
  display: flex;
  gap: 6px;
}

.btn-overlay-icon {
  background: transparent;
  border: none;
  color: #ffffff;
  font-size: 16px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-overlay-icon:hover, .btn-overlay-icon:focus-visible {
  background: rgba(255, 255, 255, 0.25);
  outline: 2px solid #ffffff;
}

.overlay-body {
  padding: 12px 14px;
  max-height: 400px;
  overflow-y: auto;
  background: #f8fafc;
}

.overlay-status-banner {
  padding: 8px 10px;
  border-radius: 6px;
  background: #e2e8f0;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 10px;
  color: #0f172a;
}

.overlay-status-banner.success {
  background: #dcfce7;
  color: #166534;
  border: 1px solid #86efac;
}

.overlay-status-banner.prompt {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fde68a;
}

/* Discovered Jobs List */
.overlay-jobs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}

.overlay-job-item {
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.overlay-job-item:hover, .overlay-job-item:focus-visible {
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
  outline: none;
}

.overlay-job-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2px;
}

.overlay-job-title {
  font-weight: 700;
  font-size: 13px;
  color: #0f172a;
}

.overlay-job-index {
  background: #2563eb;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
}

.overlay-job-meta {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 6px;
}

.btn-overlay-select {
  background: #2563eb;
  color: #ffffff;
  border: none;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  width: 100%;
}

.btn-overlay-select:hover, .btn-overlay-select:focus-visible {
  background: #1d4ed8;
  outline: 2px solid #2563eb;
}

/* Confirmation Gate */
.overlay-confirm-card {
  background: #ffffff;
  border: 2px solid #f59e0b;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 10px;
}

.overlay-confirm-heading {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 800;
  color: #d97706;
  margin-bottom: 4px;
}

.overlay-confirm-job-title {
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 2px;
}

.overlay-confirm-meta {
  font-size: 12px;
  color: #64748b;
  margin: 0 0 8px;
}

.overlay-confirm-prompt {
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 10px;
}

.overlay-btn-row {
  display: flex;
  gap: 8px;
}

.btn-confirm-primary {
  flex: 1;
  background: #2563eb;
  color: #ffffff;
  border: none;
  padding: 7px 12px;
  border-radius: 6px;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
}

.btn-confirm-primary:hover, .btn-confirm-primary:focus-visible {
  background: #1d4ed8;
  outline: 2px solid #2563eb;
}

.btn-confirm-secondary {
  flex: 1;
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #cbd5e1;
  padding: 7px 12px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}

.btn-confirm-secondary:hover, .btn-confirm-secondary:focus-visible {
  background: #e2e8f0;
  outline: 2px solid #64748b;
}

/* Question Section */
.overlay-question-card {
  background: #ffffff;
  border: 2px solid #3b82f6;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 10px;
}

.overlay-question-text {
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 8px;
}

.overlay-answer-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 8px;
}

.overlay-answer-input:focus {
  outline: 2px solid #2563eb;
  border-color: #2563eb;
}

/* Overlay Footer */
.overlay-footer {
  background: #ffffff;
  border-top: 1px solid #e2e8f0;
  padding: 8px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: #64748b;
}

.overlay-voice-pill {
  display: flex;
  align-items: center;
  gap: 5px;
  font-weight: 600;
  font-size: 11px;
}

.overlay-voice-pill.listening {
  color: #dc2626;
}

.overlay-voice-pill.ready {
  color: #166534;
}

/* Minimized Mode */
.accessapply-overlay-container.minimized .overlay-body,
.accessapply-overlay-container.minimized .overlay-footer {
  display: none;
}

.accessapply-overlay-container.minimized {
  width: auto;
  border-radius: 8px;
}

/* High Contrast & Accessibility */
@media (prefers-contrast: more) {
  .accessapply-overlay-container {
    border: 3px solid #000000;
  }
  .overlay-header {
    background: #000000;
    color: #ffffff;
  }
  .overlay-job-item {
    border: 2px solid #000000;
  }
}

@media (prefers-reduced-motion: reduce) {
  .accessapply-overlay-container {
    transition: none;
  }
}
`;

export function initOverlay(): void {
  if (overlayHost) return;

  overlayHost = document.createElement("div");
  overlayHost.id = "accessapply-overlay-host";
  shadowRoot = overlayHost.attachShadow({ mode: "open" });

  const styleEl = document.createElement("style");
  styleEl.textContent = OVERLAY_CSS;
  shadowRoot.append(styleEl);

  const container = document.createElement("div");
  container.className = "accessapply-overlay-container";
  container.role = "region";
  container.setAttribute("aria-label", "AccessApply Assistant");
  container.setAttribute("aria-live", "polite");

  container.innerHTML = `
    <header class="overlay-header">
      <div class="overlay-title-group">
        <span>AccessApply</span>
        <span id="overlay-mode-badge" class="overlay-status-pill">Active</span>
      </div>
      <div class="overlay-controls">
        <button id="btn-overlay-minimize" type="button" class="btn-overlay-icon" title="Minimize / Expand Assistant" aria-label="Minimize or Expand AccessApply Overlay">_</button>
        <button id="btn-overlay-close" type="button" class="btn-overlay-icon" title="Hide Overlay" aria-label="Close AccessApply Overlay">×</button>
      </div>
    </header>
    <div id="overlay-body-content" class="overlay-body">
      <div id="overlay-banner" class="overlay-status-banner">Ready to assist with your job applications.</div>
      <div id="overlay-jobs-section" hidden>
        <div id="overlay-jobs-list" class="overlay-jobs-list"></div>
      </div>
      <div id="overlay-confirm-section" class="overlay-confirm-card" hidden></div>
      <div id="overlay-question-section" class="overlay-question-card" hidden></div>
    </div>
    <footer class="overlay-footer">
      <span id="overlay-voice-status" class="overlay-voice-pill ready">🎤 Voice Ready</span>
      <span class="small-text">Press 1-9 to choose</span>
    </footer>
  `;

  shadowRoot.append(container);
  document.documentElement.append(overlayHost);

  // Wire header buttons
  const btnMin = shadowRoot.getElementById("btn-overlay-minimize");
  const btnClose = shadowRoot.getElementById("btn-overlay-close");

  btnMin?.addEventListener("click", () => {
    isMinimized = !isMinimized;
    container.classList.toggle("minimized", isMinimized);
    if (btnMin) btnMin.textContent = isMinimized ? "□" : "_";
  });

  btnClose?.addEventListener("click", () => {
    if (overlayHost) overlayHost.style.display = "none";
  });

  // Keyboard shortcut listener on webpage for Job Selection (1-9)
  window.addEventListener("keydown", (e) => {
    if (
      document.activeElement?.tagName === "INPUT" ||
      document.activeElement?.tagName === "TEXTAREA"
    ) {
      return;
    }
    if (currentState.discoveredJobs && currentState.discoveredJobs.length > 0) {
      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= currentState.discoveredJobs.length) {
        const job = currentState.discoveredJobs[num - 1];
        if (job) {
          e.preventDefault();
          chrome.runtime.sendMessage({ type: "SELECT_JOB", job });
        }
      }
    }
  });
}

export function updateOverlay(state: OverlayState): void {
  if (!overlayHost) initOverlay();
  if (!overlayHost || !shadowRoot) return;

  currentState = state;
  overlayHost.style.display = state.visible === false ? "none" : "block";

  const banner = shadowRoot.getElementById("overlay-banner");
  const jobsSection = shadowRoot.getElementById("overlay-jobs-section");
  const jobsList = shadowRoot.getElementById("overlay-jobs-list");
  const confirmSection = shadowRoot.getElementById("overlay-confirm-section");
  const questionSection = shadowRoot.getElementById("overlay-question-section");
  const voicePill = shadowRoot.getElementById("overlay-voice-status");

  // 1. Status banner
  if (banner) {
    if (state.completed) {
      banner.className = "overlay-status-banner success";
      banner.textContent = state.statusText || "Application submitted successfully!";
    } else if (state.pendingConfirmation || state.pendingQuestion) {
      banner.className = "overlay-status-banner prompt";
      banner.textContent = state.statusText || "Awaiting your choice or answer...";
    } else {
      banner.className = "overlay-status-banner";
      banner.textContent = state.statusText || "AccessApply is active.";
    }
  }

  // 2. Discovered Jobs
  if (jobsSection && jobsList) {
    if (state.discoveredJobs && state.discoveredJobs.length > 0) {
      jobsSection.hidden = false;
      jobsList.replaceChildren();

      state.discoveredJobs.forEach((job, index) => {
        const item = document.createElement("div");
        item.className = "overlay-job-item";
        item.tabIndex = 0;
        item.setAttribute("role", "button");
        item.setAttribute("aria-label", `Job ${index + 1}: ${job.title} at ${job.company || "company"}`);

        item.innerHTML = `
          <div class="overlay-job-title-row">
            <span class="overlay-job-title">${job.title}</span>
            <span class="overlay-job-index">${index + 1}</span>
          </div>
          <div class="overlay-job-meta">${[job.company, job.location, job.salary].filter(Boolean).join(" · ")}</div>
          <button type="button" class="btn-overlay-select">Select Job</button>
        `;

        const selectBtn = item.querySelector("button");
        const trigger = () => {
          chrome.runtime.sendMessage({ type: "SELECT_JOB", job });
        };

        selectBtn?.addEventListener("click", (e) => {
          e.stopPropagation();
          trigger();
        });
        item.addEventListener("click", trigger);
        item.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            trigger();
          }
        });

        jobsList.append(item);
      });
    } else {
      jobsSection.hidden = true;
    }
  }

  // 3. Confirmation Gate
  if (confirmSection) {
    if (state.pendingConfirmation) {
      confirmSection.hidden = false;
      const pc = state.pendingConfirmation;
      const job = pc.job;
      confirmSection.innerHTML = `
        <div class="overlay-confirm-heading">Human Confirmation Gate</div>
        <h4 class="overlay-confirm-job-title">${job?.title || "Application Confirmation"}</h4>
        <p class="overlay-confirm-meta">${[job?.company, job?.location, job?.salary].filter(Boolean).join(" · ")}</p>
        <p class="overlay-confirm-prompt">${pc.message}</p>
        <div class="overlay-btn-row">
          <button id="btn-overlay-confirm-yes" type="button" class="btn-confirm-primary">${pc.type === "apply" ? "Yes, Apply" : "Yes, Submit"}</button>
          <button id="btn-overlay-confirm-no" type="button" class="btn-confirm-secondary">Cancel</button>
        </div>
      `;

      confirmSection.querySelector("#btn-overlay-confirm-yes")?.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "CONFIRM_APPLICATION" });
      });
      confirmSection.querySelector("#btn-overlay-confirm-no")?.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "CANCEL_APPLICATION" });
      });
    } else {
      confirmSection.hidden = true;
    }
  }

  // 4. Question Section
  if (questionSection) {
    if (state.pendingQuestion) {
      questionSection.hidden = false;
      questionSection.innerHTML = `
        <p class="overlay-question-text">${state.pendingQuestion}</p>
        <input id="overlay-user-answer" type="text" class="overlay-answer-input" placeholder="Type answer or speak..." />
        <button id="btn-overlay-send-answer" type="button" class="btn-confirm-primary">Submit Answer</button>
      `;

      const input = questionSection.querySelector("#overlay-user-answer") as HTMLInputElement | null;
      const sendBtn = questionSection.querySelector("#btn-overlay-send-answer");

      const doSend = () => {
        const val = input?.value.trim();
        if (val) {
          chrome.runtime.sendMessage({ type: "RESPOND_TO_TASK", answer: val });
        }
      };

      sendBtn?.addEventListener("click", doSend);
      input?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") doSend();
      });
      setTimeout(() => input?.focus(), 100);
    } else {
      questionSection.hidden = true;
    }
  }

  // 5. Voice pill
  if (voicePill) {
    if (state.voiceState === "listening") {
      voicePill.className = "overlay-voice-pill listening";
      voicePill.textContent = "🔴 Listening...";
    } else {
      voicePill.className = "overlay-voice-pill ready";
      voicePill.textContent = "🎤 Voice Ready";
    }
  }
}
