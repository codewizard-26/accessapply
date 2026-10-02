# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  # AccessApply Accessibility UI

  AccessApply is an accessibility assistant that helps users interact with existing job websites. This package contains the accessibility-focused React frontend for the browser extension or side-panel experience.

  This package is currently a standalone React development preview. It is not itself the Chrome extension.

  ## Tech Stack

  - React 19
  - TypeScript
  - Vite
  - Tailwind CSS 4
  - ESLint

  Styling is primarily maintained in `src/App.css`. Shared theme tokens are available from `../../shared/styles/design-tokens.css` for coordinated frontend styling.

  ## Running the Project

  ```powershell
  cd D:\accessapply\accessibility-ui
  npm install
  npm run dev
  ```

  Vite normally serves the development preview at [http://localhost:5173/](http://localhost:5173/).

  ```powershell
  npm run lint
  npm run build
  ```

  ## Current Features

  - Assistant, History, and Accessibility navigation
  - Guide me, Assist me, and Act for me modes
  - Natural-language command input
  - Mock agent responses
  - Processing and completion states
  - Transcript and captions
  - Browser speech-recognition voice-command UI
  - Native browser text-to-speech
  - Play, Pause, Resume, Stop, and Replay speech controls
  - Accessibility Preferences
  - Eight session-only preferences
  - Keyboard accessibility
  - Responsive narrow-panel layout

  ## Architecture

  ```text
  User
    |
    v
  App.tsx
    |
    v
  useAgent()
    |
    v
  AgentService
    |
    v
  mockAgentService
    |
    v
  AgentResponse
    |
    v
  Transcript
    |
    v
  SpeechControls
  ```

  The mock service is intentionally used so frontend development does not depend on the backend team.

  ## Agent Integration Contract

  The agent contracts live in `src/types/agent.ts` and include:

  - `AgentRequest`
  - `AgentResponse`
  - `AgentService`
  - `AssistanceMode`
  - `AgentStatus`
  - `TranscriptEntry`
  - `VoiceState`
  - `SpeechState`

  An `AgentRequest` contains:

  ```ts
  {
    command: string;
    mode: AssistanceMode;
  }
  ```

  The service boundary is:

  ```ts
  interface AgentService {
    execute(request: AgentRequest): Promise<AgentResponse>;
  }
  ```

  The current frontend does not call the backend. A future backend or AI implementation can replace the mock implementation behind this contract.

  ## Mock Agent

  The mock implementation is in `src/services/mockAgent.ts`. It keeps a 450ms delay and currently responds as follows:

  ```text
  "Read the requirements"
    -> requirements response

  "Explain"
    -> page explanation

  "Guide"
    -> step-by-step guidance

  Other commands
    -> generic response
  ```

  The mock service currently ignores the selected mode, but it receives the mode through `AgentRequest` so a future agent can use it.

  ## Speech Architecture

  `src/components/SpeechControls.tsx` uses the browser-native `window.speechSynthesis` API and `SpeechSynthesisUtterance`.

  Supported operations:

  - Play
  - Pause
  - Resume
  - Stop
  - Replay

  Speech completion updates the UI, errors use a friendly message, and unsupported browsers receive a clear fallback. Active speech is cancelled when the component unmounts or when the response changes.

  **This is browser-native text-to-speech, not an external speech service.**

  ## Voice Command

  `src/components/VoiceCommand.tsx` provides the voice interaction UI.

  Voice input uses the browser `SpeechRecognition` API with a `webkitSpeechRecognition` fallback where available. It supports Idle, Listening, Processing, Error, and unsupported-browser states. The Voice commands preference can disable the control. Recognition is used only to control this frontend; it does not provide browser automation or external speech services.

  ## Accessibility Preferences

  The central preference type is in `src/types/accessibility.ts`:

  ```text
  voiceCommands
  readContentAloud
  textOnlyMode
  captions
  simplifiedLanguage
  keyboardFirstNavigation
  stepByStepGuidance
  reducedVisualClutter
  ```

  These preferences are session-only React state and are not persisted.

  ## Accessibility Design

  The UI currently uses:

  - Semantic HTML and native form controls
  - Keyboard navigation and visible focus states
  - Screen-reader-friendly labels
  - Explicit Enabled/Disabled text
  - No color-only status communication
  - Semantic status and error announcements
  - Reduced duplicate live-region announcements
  - Reduced-motion support
  - Responsive narrow-panel behavior

  ## Extension Integration Boundary

  This package is not responsible for:

  - Chrome extension manifest
  - Side-panel registration
  - Popup registration
  - Content scripts
  - DOM automation
  - Browser tab interaction
  - Job website interaction

  Those responsibilities belong to `extension/`.

  ## Backend Integration Boundary

  The future AI/backend team can replace the mock implementation behind the existing `AgentService` abstraction. This frontend does not include backend URLs, API calls, or a backend client.

  ## Known Limitations

  These are intentional project boundaries, not bugs:

  - Voice commands depend on browser speech-recognition support.
  - Agent responses are mocked.
  - Browser automation is not implemented.
  - Chrome extension packaging is not implemented here.
  - History is currently a placeholder.
  - Accessibility preferences are session-only.
  - Backend and AI integration are not connected.

  ## Demo Flow

  1. Open AccessApply.
  2. Select **Guide me**.
  3. Enter `Read the requirements of this job.`
  4. Submit the command.
  5. Show **Processing**.
  6. Show the mock requirements response.
  7. Show **Action completed**.
  8. Show the transcript.
  9. Press **Play**.
  10. Demonstrate browser text-to-speech.
  11. Open **Accessibility**.
  12. Toggle Captions or Voice commands.
  13. Return to **Assistant**.

  ## Development Boundaries

  Changes for this package should remain inside:

  ```text
  accessibility-ui/
  ```

  Do not modify `profile-ui/`, `backend/`, `extension/`, or `shared/types/` unless the team explicitly agrees to a future integration change.
