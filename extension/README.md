# AccessApply Chrome Extension

Web automation module for AccessApply: reads job pages into a structured,
screen-reader-friendly context and performs validated browser actions
(click, type, scroll, navigate, read). All AI reasoning lives in the
backend; this extension only orchestrates on the browser side.

## Dependencies

- Node 18+ (Node 20+ recommended)
- Chrome 116+ (Manifest V3)

Dev dependencies: `typescript`, `esbuild`, `@types/chrome`.

```powershell
cd extension
npm install
```

## Build

```powershell
npm run build        # typecheck + bundle into dist/
npm run typecheck    # tsc --noEmit only
npm run build:only   # bundle without typecheck (faster, dev loop)
npm run clean        # remove dist/
```

`npm run build` runs `tsc` as a type gate and then `scripts/build.mjs`,
which bundles `src/content.ts`, `src/background.ts` and
`src/popup/popup.ts` into classic IIFE scripts (content scripts and MV3
service workers cannot be ES modules) and copies `public/` (manifest,
popup) into `dist/`.

## Load the extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `extension/dist`

After editing source, run `npm run build:only` and hit the reload icon on
the extension card.

## Mock mode

Mock mode is ON by default and needs no backend. In the popup:

- toggle **Mock mode**
- pick a **Mock scenario**:
  - `click` / `type` / `scroll` / `navigate` / `read` - a single action of that kind
  - `auto` - scripted sequence (type -> click -> scroll -> done) exercising the full loop
  - `invalid_action` - returns an action that fails validation
  - `invalid_response` - simulates an unusable backend response
  - `backend_error` - simulates HTTP 500

Or use the **Mock click / type / scroll / read / failure** buttons to push
a fixed action directly.

## Test pages

`test-page/index.html` is a local job page with headings, buttons, links,
labelled inputs (including a password field), a select, an aria-labelled
icon button, hidden text that must never be scanned, and a tall scroll
area. Serve it and open it in Chrome:

```powershell
npx http-server extension/test-page -p 8080
# or: npx serve extension/test-page
```

Then: open the popup -> **Scan page** -> check the element/job counts ->
run a mock action -> confirm the status line and log.

## Configure the backend

In the popup Settings section (persisted in `chrome.storage.local`):

| field                       | default                  | meaning                             |
| --------------------------- | ------------------------ | ----------------------------------- |
| Backend URL                 | `http://localhost:5000`  | base URL of the backend             |
| Next-action route           | `/api/agent/next-action` | POST target                         |
| Health route                | `/api/health`            | GET probe shown in the popup        |
| Max iterations              | 10                       | loop safety limit (1-50)            |
| Allow consequential actions | off                      | gate for submit/apply/accept clicks |

Settings are validated and clamped (`validate.ts`); an invalid value is
rejected with a structured error, never silently applied.

## Schemas

### Webpage context (`PageContext`)

```jsonc
{
  "url": "https://example.com/jobs",
  "title": "Frontend Developer",
  "text": "visible page prose, max 4000 chars",
  "elements": [
    {
      "id": "el_1", // stable for this scan only
      "type": "button", // button | input | textarea | select | link |
      // heading | checkbox | radio | option | ...
      "tag": "button",
      "role": "button", // explicit or implicit ARIA role
      "text": "Apply Now",
      "accessibleName": "Apply Now",
      "label": "Email address", // associated <label> text (form controls)
      "placeholder": "Enter your email",
      "inputType": "email", // inputs only
      "href": "https://...", // links only
      "disabled": false,
      "required": true,
      "options": ["1 week", "2 weeks"], // selects only
      "level": 2, // headings only
    },
  ],
  "job": {
    // best-effort, only when detected
    "title": "Frontend Developer",
    "location": "Remote (US)",
    "employmentType": "Full-time",
    "workMode": "remote", // remote | hybrid | onsite | unknown
    "salary": "$120,000 - $160,000",
    "requirements": ["Strong TypeScript..."],
    "applicationInstructions": "Click the apply button below...",
  },
  "scannedAt": 1730000000000,
  "focusedElementId": "el_7",
  "loading": false,
}
```

Excluded by design: hidden/`aria-hidden` elements, `script`/`style`
content, password/file/hidden input values, and any field whose label
looks sensitive (password, OTP, card number, SSN...).

### Action request

```jsonc
{ "action": "click", "target": "el_1" }
{ "action": "type", "target": "el_2", "value": "user@example.com", "append": false, "blur": true }
{ "action": "scroll", "direction": "down", "amount": 600 }
{ "action": "navigate", "url": "https://example.com/jobs", "newTab": false }
{ "action": "read", "target": "el_3" }
{ "action": "ask_user", "question": "Which resume should I use?" }
{ "action": "done" }
```

Every action is validated at runtime (`validateAction`) before execution.
`type` accepts text inputs and textareas; values are typed through real
focus/input/change events so site validation runs normally.

### Action response

```jsonc
// success
{ "ok": true, "action": "click", "message": "Clicked 'Apply Now'.", "data": {} }

// failure - always structured, never a thrown error
{ "ok": false, "action": "click",
  "error": { "code": "TARGET_DISABLED", "message": "..." } }
```

Error codes: `INVALID_ACTION`, `INVALID_TARGET`, `TARGET_DETACHED`,
`TARGET_HIDDEN`, `TARGET_DISABLED`, `TARGET_NOT_EDITABLE`,
`UNSUPPORTED_TARGET`, `BLOCKED_URL`, `REQUIRES_AUTHORIZATION`,
`CONSEQUENTIAL_ACTION`, `TIMEOUT`, `PAGE_CHANGED`, `BACKEND_ERROR`,
`BACKEND_UNAVAILABLE`, `INVALID_BACKEND_RESPONSE`, `ITERATION_LIMIT`,
`REPEATED_FAILURE`, `CANCELLED`, `INTERNAL_ERROR`.

## Backend integration contract

The extension is the client; it assumes nothing beyond this:

```
POST {backendUrl}{nextActionPath}
Body:    { "sessionId": "s_...", "iteration": 1, "page": <PageContext> }
200:     { "action": <Action request> }        // wrapper form
         <Action request>                       // bare form also accepted
         { "data": <Action request> }           // also accepted

GET  {backendUrl}{healthPath}                   // any 2xx counts as healthy
```

Rules the backend must respect:

- The action must match one of the shapes above; anything else is rejected
  as `INVALID_BACKEND_RESPONSE`.
- URLs in `navigate` must be absolute `http(s)`; `javascript:`, `data:`,
  `file:` and `vbscript:` are refused (`BLOCKED_URL`).
- The extension never evaluates code received from the backend.
- Passwords and similar secrets are never sent; `page` is sanitized again
  before leaving the browser as defence in depth.
- Consequential targets (submit/apply/accept terms) fail with
  `CONSEQUENTIAL_ACTION` unless the user enabled the setting and is
  supervising; profile information is never invented.

## Agent loop

READ PAGE -> SEND CONTEXT -> RECEIVE ACTION -> VALIDATE -> EXECUTE ->
WAIT FOR PAGE UPDATE -> READ AGAIN

- Runs from the popup (**Start agent loop**); each iteration is logged and
  visible there.
- Stops safely on: iteration limit, 3 consecutive failures, backend
  errors, invalid actions, `done`, `ask_user`, or the user pressing Stop.
- State lives in `chrome.storage.session`, so MV3 service worker restarts
  and tab navigation do not corrupt it; no durable state in globals.
- The POST body includes `sessionId` and `iteration` so the backend can
  track multi-step sessions.

## Tests

```powershell
npm test   # node --test scripts/smoke-test.mjs
```

Covers action validation, URL policy, settings clamping, wire
sanitisation and all mock scenarios (including simulated failures).
Browser-dependent code (scanner/actions) is exercised against
`test-page/`; `scripts/verify-scanner.mjs` automates that in a headless
browser if you have Playwright's Chromium installed.

## Current limitations

- Targets are scoped to a single scan: after a page change the backend
  must re-read the context before referencing ids.
- Job metadata extraction is heuristic (visible text + JSON-LD
  `JobPosting`); it may miss data on heavily JS-rendered pages that render
  after the scan.
- Only top-frame content is scanned (`all_frames: false`).
- `type` does not support rich text editors or file pickers.
- No automatic waiting for SPA route changes beyond a settle delay and
  tab `complete` check.
- The popup is a test harness, not the accessibility interface (that is
  the React app owned by another module).
- Not yet verified end-to-end against a real backend; use mock mode until
  the contract above is implemented.
