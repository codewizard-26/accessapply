# AccessApply Accessibility UI

AccessApply is an accessibility assistant that helps users interact with existing job websites. This package contains the accessibility-focused React frontend for the browser extension or side-panel experience.

This package is currently a standalone React development preview. It is not itself the Chrome extension.

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- ESLint

Styling is primarily maintained in `src/App.css`.

## Running the Project

```powershell
cd D:\accessapply\accessibility-ui
npm install
npm run dev
```

Vite normally serves the development preview at `http://localhost:5173/`.

```powershell
npm run lint
npm run build
```

## Current Features

- Assistant, History, and Accessibility navigation
- Guide me, Assist me, and Act for me modes
- Typed and browser speech-recognition commands
- Mock agent responses
- Processing and completion states
- Transcript and captions
- Native browser text-to-speech
- Spoken focus and important-state feedback
- Discover-before-activate hover descriptions and focused-control explanations
- Play, Pause, Resume, Stop, and Replay speech controls
- Accessibility Preferences
- Nine session-only preferences, including Speak focused controls
- Keyboard accessibility
- Responsive narrow-panel layout

## Architecture

```text
User input
  |
  v
App.tsx
  |
  +--> local voice command parser --> navigation/preferences
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
  +--> Transcript
  |
  +--> SpeechControls
```

The mock service is intentionally used so frontend development does not depend on the backend team.

## Agent Integration Contract

The agent contracts live in `src/types/agent.ts` and include `AgentRequest`, `AgentResponse`, `AgentService`, `AssistanceMode`, `AgentStatus`, `TranscriptEntry`, `VoiceState`, and `SpeechState`.

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

The mock implementation is in `src/services/mockAgent.ts`. It keeps a 450ms delay and responds as follows:

```text
"Read the requirements" -> requirements response
"Explain"              -> page explanation
"Guide"                -> step-by-step guidance
Other commands          -> generic response
```

The mock service currently ignores the selected mode, but it receives the mode through `AgentRequest` so a future agent can use it.

## Voice Commands

`src/components/VoiceCommand.tsx` uses the browser `SpeechRecognition` API with a `webkitSpeechRecognition` fallback where available. It supports Idle, Listening, Processing, Error, and Unsupported states, microphone permission errors, no-speech errors, stopping recognition, and cleanup on unmount.

`src/services/voiceCommandParser.ts` deterministically separates voice input into:

- Local navigation commands for Assistant, History, and Accessibility
- Local preference commands for the accessibility settings
- Assistant commands passed through the existing `useAgent()` flow

Voice recognition is browser-native. It does not use an LLM, backend service, external speech service, Chrome API, or browser automation. Unsupported browsers continue to support typed commands.

## Speech Architecture

`src/components/SpeechControls.tsx` uses `window.speechSynthesis` and `SpeechSynthesisUtterance` for browser-native text-to-speech.

Supported operations:

- Play
- Pause
- Resume
- Stop
- Replay

Speech completion, friendly errors, unsupported-browser fallback, cleanup on unmount, and cleanup when the response changes are supported.

`src/hooks/useSpokenFocus.ts` provides optional short announcements for focused controls and important UI state changes. It avoids interrupting intentional long-form speech unless an explicit page-reading command requests it.

Important controls also expose concise hover descriptions and focused-control metadata. Voice requests such as `What does this button do?`, `What is captions?`, and `Explain this option` describe the currently focused control without requiring activation first.

## Read This Page

The voice command `Read this page` speaks a concise summary of the current AccessApply page using the existing native speech synthesis mechanism. It reads relevant visible page information and active settings rather than blindly reading every DOM node.

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
speakFocusedControls
```

These preferences are session-only React state and are not persisted. `speakFocusedControls` defaults to enabled and controls automatic speech descriptions for focused buttons, tabs, modes, and settings. Disabling it does not disable voice commands or manual speech controls.

## Accessibility Design

The UI uses:

- Semantic HTML and native form controls
- Keyboard navigation and visible focus states
- Screen-reader-friendly labels
- Explicit Enabled/Disabled text
- No color-only status communication
- Semantic status and error announcements
- Reduced duplicate live-region announcements
- Reduced-motion support
- Responsive narrow-panel behavior
- Optional spoken descriptions for focused controls

## Extension Integration Boundary

This package is not responsible for the Chrome extension manifest, side-panel registration, popup registration, content scripts, DOM automation, browser tab interaction, or job website interaction. Those responsibilities belong to `extension/`.

## Backend Integration Boundary

The future AI/backend team can replace the mock implementation behind the existing `AgentService` abstraction. This frontend does not include backend URLs, API calls, or a backend client.

## Known Limitations

These are intentional project boundaries:

- Speech recognition depends on browser support and microphone permission.
- Agent responses are mocked.
- Browser automation is not implemented.
- Chrome extension packaging is not implemented here.
- History is currently a placeholder.
- Accessibility preferences are session-only.
- Backend and AI integration are not connected.

## Demo Flow

1. Open AccessApply.
2. Select **Guide me**.
3. Enter `Read the requirements of this job.` or use Voice command.
4. Show **Processing** and the mock requirements response.
5. Show **Action completed** and the transcript.
6. Press **Play** to demonstrate browser text-to-speech.
7. Say `Go to Accessibility` to open preferences.
8. Toggle Captions, Voice commands, or Speak focused controls.
9. Return to **Assistant** and use a voice or typed command.

## Development Boundaries

Changes for this package should remain inside:

```text
accessibility-ui/
```

Do not modify `profile-ui/`, `backend/`, `extension/`, or `shared/types/` unless the team explicitly agrees to a future integration change.
