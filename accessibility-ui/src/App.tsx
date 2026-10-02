import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AccessibilityPage } from './components/AccessibilityPage'
import { SpeechControls } from './components/SpeechControls'
import { Transcript } from './components/Transcript'
import { VoiceCommand } from './components/VoiceCommand'
import { useAgent } from './hooks/useAgent'
import type { AccessibilityPreferenceKey, AccessibilityPreferences } from './types/accessibility'
import type { AgentStatus, AssistanceMode, SpeechState, TranscriptEntry, VoiceState } from './types/agent'
import './App.css'

type Page = 'assistant' | 'history' | 'accessibility'

const modes: Array<{ id: AssistanceMode; label: string; description: string }> = [
  { id: 'guide', label: 'Guide me', description: 'Explain the page and keep every decision with you.' },
  { id: 'assist', label: 'Assist me', description: 'Reduce repetitive work with navigation and guidance.' },
  { id: 'act', label: 'Act for me', description: 'Perform permitted actions after keeping you informed.' },
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
}

function App() {
  const [activePage, setActivePage] = useState<Page>('assistant')
  const [mode, setMode] = useState<AssistanceMode>('guide')
  const [command, setCommand] = useState('')
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [speechState, setSpeechState] = useState<SpeechState>('ready')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [preferences, setPreferences] = useState<AccessibilityPreferences>(defaultPreferences)
  const voiceTimersRef = useRef<number[]>([])
  const { response, status, submitCommand } = useAgent()

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
      const voiceTimers = voiceTimersRef.current

      return () => {
        voiceTimers.forEach((timer) => window.clearTimeout(timer))
      }
    }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedCommand = command.trim()
    setSpeechState('ready')
    const nextResponse = await submitCommand({ command: trimmedCommand, mode })

    if (nextResponse) {
      setTranscript((currentTranscript) => [
        ...currentTranscript,
        { id: Date.now(), speaker: 'user', message: trimmedCommand },
        { id: Date.now() + 1, speaker: 'agent', message: nextResponse.message },
      ])
    }
  }

  const startVoiceCommand = () => {
    voiceTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    setVoiceState('listening')
    const processingTimer = window.setTimeout(() => {
      setVoiceState('processing')
      const completeTimer = window.setTimeout(() => {
        setCommand('Read the requirements of this job.')
        setVoiceState('idle')
      }, 450)
      voiceTimersRef.current.push(completeTimer)
    }, 700)
    voiceTimersRef.current.push(processingTimer)
  }

  const updatePreference = (setting: AccessibilityPreferenceKey, checked: boolean) => {
    setPreferences((currentPreferences) => ({ ...currentPreferences, [setting]: checked }))
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div><p className="eyebrow">Accessibility assistant</p><h1>AccessApply</h1></div>
        <p className="status" aria-live="polite"><span className="status-mark" aria-hidden="true" /><span>{displayStatus}</span></p>
      </header>

      <nav className="main-nav" aria-label="Main navigation">
        {(['assistant', 'history', 'accessibility'] as Page[]).map((page) => (
          <button className={activePage === page ? 'nav-button active' : 'nav-button'} key={page} type="button" aria-current={activePage === page ? 'page' : undefined} onClick={() => setActivePage(page)}>
            {page === 'assistant' ? 'Assistant' : page === 'history' ? 'History' : 'Accessibility'}
          </button>
        ))}
      </nav>

      <main className="main-content">
        {activePage === 'assistant' ? <>
          <section aria-labelledby="assistant-title"><p className="section-kicker">Current page</p><h2 id="assistant-title">How can I help?</h2><p className="intro">Ask for an explanation, a summary, or guidance through the next step.</p></section>

          <fieldset className="mode-picker"><legend>Assistance mode</legend><div className="mode-list">
            {modes.map((option) => <label className={mode === option.id ? 'mode-option selected' : 'mode-option'} key={option.id}>
              <input type="radio" name="assistance-mode" value={option.id} checked={mode === option.id} onChange={() => setMode(option.id)} />
              <span><strong>{option.label}</strong><small>{option.description}</small></span>
            </label>)}
          </div></fieldset>

          <form className="command-form" onSubmit={handleSubmit}><label htmlFor="command">Your request</label>
            <textarea id="command" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Try: Read the requirements of this job." rows={3} />
            <div className="command-actions"><VoiceCommand state={voiceState} onStart={startVoiceCommand} onRetry={() => setVoiceState('idle')} disabled={!preferences.voiceCommands} /><button className="primary-button" type="submit">Send request</button></div>
          </form>

          <section className="response-panel" aria-labelledby="response-title"><div className="panel-heading"><div><p className="section-kicker">Agent response</p><h2 id="response-title">What I found</h2></div>{response && <span className="response-state">Ready to read</span>}</div>
            {status === 'processing' ? <p className="response-message" role="status">Processing your request...</p> : status === 'error' ? <p className="response-message error-message" role="alert">{response?.message ?? 'Something went wrong. Please try again.'}</p> : response ? <><p className="response-message" role="status">{response.message}</p><SpeechControls key={response.message} message={response.message} onStateChange={setSpeechState} /></> : <p className="response-message muted">Your response will appear here. You stay in control of every action.</p>}
          </section>
          {preferences.captions && <Transcript entries={transcript} />}
        </> : activePage === 'accessibility' ? <AccessibilityPage preferences={preferences} onPreferenceChange={updatePreference} /> : <section aria-labelledby="placeholder-title" className="placeholder-panel"><p className="section-kicker">Recent activity</p><h2 id="placeholder-title">History is coming next</h2><p className="intro">This first slice keeps the assistant experience focused. The next step will add this view without changing the navigation.</p></section>}
      </main>
    </div>
  )
}

export default App
