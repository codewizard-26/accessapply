import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AccessibilityPage } from './components/AccessibilityPage'
import { SpeechControls } from './components/SpeechControls'
import { Transcript } from './components/Transcript'
import { VoiceCommand } from './components/VoiceCommand'
import { useAgent } from './hooks/useAgent'
import { useSpokenFocus } from './hooks/useSpokenFocus'
import { parseVoiceCommand } from './services/voiceCommandParser'
import type { AccessibilityPreferenceKey, AccessibilityPreferences } from './types/accessibility'
import type { AgentStatus, AssistanceMode, SpeechState, TranscriptEntry, VoiceState } from './types/agent'
import './App.css'

type Page = 'assistant' | 'history' | 'accessibility'

const modes: Array<{ id: AssistanceMode; label: string; description: string }> = [
  { id: 'guide', label: 'Guide me', description: 'Understand the page and follow instructions step by step.' },
  { id: 'assist', label: 'Assist me', description: 'Get help with navigation and repetitive tasks.' },
  { id: 'act', label: 'Act for me', description: 'Allow permitted actions with you informed and in control.' },
]

const exampleCommands = [
  'Read the requirements of this job.',
  'Explain this page.',
  'Guide me through this application.',
]

const agentStatusLabels: Record<AgentStatus, string> = {
  ready: 'Ready',
  listening: 'Listening',
  processing: 'Processing',
  speaking: 'Speaking',
  waiting: 'Waiting for a command',
  completed: 'Action completed',
  error: 'Needs attention',
}

const defaultPreferences: AccessibilityPreferences = {
  voiceCommands: true,
  readContentAloud: true,
  textOnlyMode: false,
  captions: true,
  simplifiedLanguage: false,
  keyboardFirstNavigation: true,
  stepByStepGuidance: true,
  reducedVisualClutter: false,
  speakFocusedControls: true,
}

const pageLabels: Record<Page, string> = {
  assistant: 'Assistant',
  history: 'History',
  accessibility: 'Accessibility',
}

function App() {
  const [activePage, setActivePage] = useState<Page>('assistant')
  const [mode, setMode] = useState<AssistanceMode>('guide')
  const [command, setCommand] = useState('')
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [speechState, setSpeechState] = useState<SpeechState>('ready')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [preferences, setPreferences] = useState<AccessibilityPreferences>(defaultPreferences)
  const commandInputRef = useRef<HTMLTextAreaElement>(null)
  const { response, status, submitCommand } = useAgent()
  const { announce, getFocusProps } = useSpokenFocus(preferences.speakFocusedControls)

  const displayStatus = speechState === 'speaking'
    ? 'Speaking'
    : speechState === 'paused'
      ? 'Reading paused'
      : voiceState === 'listening'
        ? 'Listening'
        : voiceState === 'processing'
          ? 'Processing voice command'
          : voiceState === 'error'
            ? 'Voice command needs attention'
          : agentStatusLabels[status]

  useEffect(() => {
    if (preferences.readContentAloud) announce(`${pageLabels[activePage]} page.`)
  }, [activePage, announce, preferences.readContentAloud])

    const submitAssistantCommand = async (spokenOrTypedCommand: string) => {
      const trimmedCommand = spokenOrTypedCommand.trim()
    setSpeechState('ready')
    const nextResponse = await submitCommand({ command: trimmedCommand, mode })

    if (nextResponse) {
      setTranscript((currentTranscript) => [
        ...currentTranscript,
        { id: Date.now(), speaker: 'user', message: trimmedCommand },
        { id: Date.now() + 1, speaker: 'agent', message: nextResponse.message },
      ])
      if (preferences.readContentAloud) announce('Command completed.')
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await submitAssistantCommand(command)
  }

  const handleVoiceCommand = async (recognizedCommand: string) => {
    const parsedCommand = parseVoiceCommand(recognizedCommand)

    if (parsedCommand.type === 'explain_focus') {
      const focusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
      announce(focusedElement?.dataset.voiceDescription ?? 'Move focus to a button, tab, mode, or setting to hear what it does.')
      return
    }

    if (parsedCommand.type === 'navigate') {
      setActivePage(parsedCommand.page)
      if (preferences.readContentAloud) announce(`${pageLabels[parsedCommand.page]} page opened.`)
      return
    }

    if (parsedCommand.type === 'preference') {
      updatePreference(parsedCommand.setting, parsedCommand.enabled)
      return
    }

    if (/^read (this )?page/.test(parsedCommand.command.toLowerCase().trim())) {
      const pageContent = activePage === 'accessibility'
        ? `Accessibility page. ${Object.entries(preferences).map(([setting, enabled]) => `${setting.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)} ${enabled ? 'enabled' : 'disabled'}.`).join(' ')}`
        : `${pageLabels[activePage]} page. ${response?.message ?? 'Choose an assistance mode and enter a command to get started.'}`
      announce(pageContent, true)
      return
    }

    await submitAssistantCommand(parsedCommand.command)
  }

  const updatePreference = (setting: AccessibilityPreferenceKey, checked: boolean) => {
    setPreferences((currentPreferences) => ({ ...currentPreferences, [setting]: checked }))
    const settingLabels: Record<AccessibilityPreferenceKey, string> = {
      voiceCommands: 'Voice commands',
      readContentAloud: 'Read content aloud',
      textOnlyMode: 'Text-only mode',
      captions: 'Captions',
      simplifiedLanguage: 'Simplified language',
      keyboardFirstNavigation: 'Keyboard-first navigation',
      stepByStepGuidance: 'Step-by-step guidance',
      reducedVisualClutter: 'Reduced visual clutter',
      speakFocusedControls: 'Speak focused controls',
    }
    if (preferences.readContentAloud) announce(`${settingLabels[setting]} ${checked ? 'enabled' : 'disabled'}.`)
  }

  const chooseExampleCommand = (example: string) => {
    setCommand(example)
    commandInputRef.current?.focus()
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div><p className="eyebrow">Accessibility assistant</p><h1>AccessApply</h1></div>
        <p className="status" aria-live="polite"><span className="status-mark" aria-hidden="true" /><span>{displayStatus}</span></p>
      </header>

      <nav className="main-nav" aria-label="Main navigation">
        {(['assistant', 'history', 'accessibility'] as Page[]).map((page) => (
          <button {...getFocusProps(`${pageLabels[page]} tab.`)} data-voice-description={`${pageLabels[page]} tab. Opens the ${pageLabels[page].toLowerCase()} page.`} title={`Open ${pageLabels[page]}`} className={activePage === page ? 'nav-button active' : 'nav-button'} key={page} type="button" aria-current={activePage === page ? 'page' : undefined} onClick={() => setActivePage(page)}>
            <span>{page === 'assistant' ? 'Assistant' : page === 'history' ? 'History' : 'Accessibility'}</span>
            {activePage === page && <span className="nav-current">Current</span>}
          </button>
        ))}
      </nav>

      <main className="main-content">
        {activePage === 'assistant' ? <>
          <section aria-labelledby="assistant-title"><p className="section-kicker">Current page</p><h2 id="assistant-title">How can I help?</h2><p className="intro">Ask for an explanation, a summary, or guidance through the next step.</p></section>

          <fieldset className="mode-picker"><legend>Assistance mode</legend><div className="mode-list">
            {modes.map((option) => <label className={mode === option.id ? 'mode-option selected' : 'mode-option'} title={option.description} key={option.id}>
              <input {...getFocusProps(`${option.label} mode. ${mode === option.id ? 'Currently selected.' : 'Not selected.'}`)} data-voice-description={`${option.label} mode. ${option.description} ${mode === option.id ? 'Currently selected.' : 'Not selected.'}`} title={option.description} type="radio" name="assistance-mode" value={option.id} checked={mode === option.id} onChange={() => { setMode(option.id); if (preferences.readContentAloud) announce(`${option.label} mode selected.`) }} />
              <span><strong>{option.label}</strong><small>{option.description}</small></span>
            </label>)}
          </div></fieldset>

          <form className="command-form" onSubmit={handleSubmit}><label htmlFor="command">Your request</label>
            <textarea {...getFocusProps('Your request. Text area.')} data-voice-description="Your request. Text area. Enter a command for AccessApply." title="Enter a command for AccessApply" ref={commandInputRef} id="command" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Try: Read the requirements of this job." rows={3} />
            <div className="command-actions"><VoiceCommand state={voiceState} onRetry={() => setVoiceState('idle')} onCommand={handleVoiceCommand} onStateChange={setVoiceState} speakFocusedControls={preferences.speakFocusedControls} readContentAloud={preferences.readContentAloud} disabled={!preferences.voiceCommands} /><button {...getFocusProps('Send command button.')} data-voice-description="Send command button. Submits your typed command to AccessApply." title="Send command to AccessApply" className="primary-button" type="submit">Send request</button></div>
          </form>

          <section className="response-panel" aria-labelledby="response-title"><div className="panel-heading"><div><p className="section-kicker">Agent response</p><h2 id="response-title">What I found</h2></div>{response?.status === 'success' && <span className="response-state">Action completed</span>}</div>
            {status === 'processing' ? <p className="response-message" role="status">Processing your request...</p> : status === 'error' ? <p className="response-message error-message" role="alert">{response?.message ?? 'Something went wrong. Please try again.'}</p> : response ? <><p className="response-message" role="status">{response.message}</p><SpeechControls key={response.message} message={response.message} onStateChange={setSpeechState} speakFocusedControls={preferences.speakFocusedControls} enabled={preferences.readContentAloud} /></> : <div className="empty-response"><p className="response-message muted">Your response will appear here. Start with one of these requests:</p><div className="example-list" aria-label="Example requests">{exampleCommands.map((example) => <button {...getFocusProps(`${example} example command.`)} className="example-button" key={example} type="button" onClick={() => chooseExampleCommand(example)}>{example}</button>)}</div></div>}
          </section>
          {preferences.captions && <Transcript entries={transcript} />}
        </> : activePage === 'accessibility' ? <AccessibilityPage preferences={preferences} onPreferenceChange={updatePreference} speakFocusedControls={preferences.speakFocusedControls} /> : <section aria-labelledby="placeholder-title" className="placeholder-panel"><p className="section-kicker">Recent activity</p><h2 id="placeholder-title">History is coming next</h2><p className="intro">This first slice keeps the assistant experience focused. The next step will add this view without changing the navigation.</p></section>}
      </main>
    </div>
  )
}

export default App
