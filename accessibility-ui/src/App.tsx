import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AccessibilityPage } from './components/AccessibilityPage'
import { SpeechControls } from './components/SpeechControls'
import { Transcript } from './components/Transcript'
import { useAgent } from './hooks/useAgent'
import { useSpokenFocus } from './hooks/useSpokenFocus'
import { useVoiceControl } from './hooks/useVoiceControl'
import type { AccessibilityPreferenceKey, AccessibilityPreferences } from './types/accessibility'
import type { AgentStatus, AssistanceMode, SpeechState, TranscriptEntry } from './types/agent'
import { getExtensionPageUrl, getProfileState, subscribeToProfileChanges } from '../../shared/profile/profileStorage.mjs'
import type { UserProfile } from '../../shared/types/profile'
import { parseVoiceCommand } from '../../shared/voice/voiceCommandParser.mjs'
import type { VoiceCommand } from '../../shared/voice/voiceCommandParser.mjs'
import { speakText, stopSpeaking } from '../../shared/voice/speak.mjs'
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
  const [savedProfile, setSavedProfile] = useState<UserProfile | null>(null)
  const [profileState, setProfileState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [profileError, setProfileError] = useState('')
  const [activePage, setActivePage] = useState<Page>('assistant')
  const [mode, setMode] = useState<AssistanceMode>('guide')
  const [command, setCommand] = useState('')
  const [speechState, setSpeechState] = useState<SpeechState>('ready')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [voiceFeedback, setVoiceFeedback] = useState('')
  const [voiceSpeechState, setVoiceSpeechState] = useState('')
  const setVoiceControlEnabledRef = useRef<((enabled: boolean) => Promise<boolean>) | null>(null)
  const [preferences, setPreferences] = useState<AccessibilityPreferences>(defaultPreferences)
  const commandInputRef = useRef<HTMLTextAreaElement>(null)
  const { response, status, submitCommand } = useAgent()
  const { announce, getFocusProps } = useSpokenFocus(preferences.speakFocusedControls)

  useEffect(() => {
    let isActive = true
    let unsubscribe = () => {}
    getProfileState()
      .then((state) => {
        if (!isActive) return
        if (state?.profileCompleted && state.profile) {
          setSavedProfile(state.profile)
          setProfileState('ready')
          setProfileError('')
        } else {
          setSavedProfile(null)
          setProfileState('missing')
          setProfileError('No completed profile is available. Set up your profile to continue.')
        }
        try {
          unsubscribe = subscribeToProfileChanges(
            (changedState) => {
              if (!isActive) return
              if (changedState?.profileCompleted && changedState.profile) {
                setSavedProfile(changedState.profile)
                setProfileState('ready')
                setProfileError('')
              } else {
                setSavedProfile(null)
                setProfileState('missing')
                setProfileError('No completed profile is available. Set up your profile to continue.')
              }
            },
            (error) => {
              if (!isActive) return
              setProfileError(error.message)
              setProfileState('error')
            },
          )
        } catch (error) {
          setProfileError(error instanceof Error ? error.message : 'Profile updates are unavailable.')
          setProfileState('error')
        }
      })
      .catch((error: unknown) => {
        if (!isActive) return
        setProfileError(error instanceof Error ? error.message : 'The saved profile could not be loaded.')
        setProfileState('error')
      })

    return () => {
      isActive = false
      unsubscribe()
    }
  }, [])

  const displayStatus = speechState === 'speaking'
    ? 'Speaking'
    : speechState === 'paused'
      ? 'Reading paused'
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
    return nextResponse
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await submitAssistantCommand(command)
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

  const speakVoiceFeedback = (message: string) => {
    setVoiceFeedback(message)
    speakText(message, setVoiceSpeechState)
  }

  const navigateToPage = (page: Page) => {
    setActivePage(page)
    if (preferences.readContentAloud) announce(`${pageLabels[page]} page opened.`)
  }

  const handleVoiceCommands = async (commands: VoiceCommand[]) => {
    const pages: Page[] = ['assistant', 'history', 'accessibility']
    for (const command of commands) {
      if (command.type === 'STOP') {
        stopSpeaking()
        setVoiceSpeechState('ready')
        setVoiceFeedback('Speech stopped.')
        continue
      }
      if (command.type === 'CANCEL') {
        stopSpeaking()
        setVoiceSpeechState('ready')
        setVoiceFeedback('Cancelled.')
        continue
      }
      if (command.type === 'HELP') {
        speakVoiceFeedback('You can say: read this page, next, previous, open accessibility, read the requirements, edit my profile, or stop.')
        continue
      }
      if (command.type === 'SET_VOICE_CONTROL') {
        const setEnabled = setVoiceControlEnabledRef.current
        const saved = setEnabled ? await setEnabled(command.enabled) : false
        if (saved && !command.enabled) {
          const message = 'Voice control is off. Use the Voice Control toggle to turn it on again.'
          setVoiceFeedback(message)
          speakText(message, setVoiceSpeechState)
        } else if (saved) {
          speakVoiceFeedback('Voice control is on.')
        }
        continue
      }
      if (command.type === 'EDIT_PROFILE') {
        openProfileEditor()
        continue
      }
      if (command.type === 'NAVIGATE') {
        if (command.destination === 'profile') {
          openProfileEditor()
        } else {
          speakVoiceFeedback(`There is no ${command.destination} page in the assistant. You can open your profile editor or ask for help.`)
        }
        continue
      }
      if (command.type === 'NEXT' || command.type === 'PREVIOUS') {
        const currentIndex = pages.indexOf(activePage)
        const offset = command.type === 'NEXT' ? 1 : -1
        const nextPage = pages[(currentIndex + offset + pages.length) % pages.length]
        if (nextPage) {
          navigateToPage(nextPage)
          speakVoiceFeedback(`${pageLabels[nextPage]} page.`)
        }
        continue
      }
      if (command.type === 'READ_PAGE') {
        const message = activePage === 'accessibility'
          ? `Accessibility settings. ${Object.entries(preferences).filter(([, enabled]) => enabled).length} settings are enabled.`
          : `${pageLabels[activePage]} page. ${response?.message ?? 'Choose an assistance mode and say a command.'}`
        speakVoiceFeedback(message.slice(0, 400))
        continue
      }
      if (command.type === 'READ_FIELD') {
        const activeElement = document.activeElement
        const label = activeElement instanceof HTMLElement && activeElement.id
          ? document.querySelector(`label[for="${CSS.escape(activeElement.id)}"]`)?.textContent?.trim()
          : null
        speakVoiceFeedback(label ? `${label}.` : 'Move keyboard focus to a field to hear its label.')
        continue
      }
      if (command.type === 'READ_MISSING') {
        speakVoiceFeedback('No job application form is open in the assistant right now. Say edit my profile to open your saved information.')
        continue
      }
      if (command.type === 'ASSISTANT_REQUEST') {
        const result = await submitAssistantCommand(command.command)
        if (result) speakVoiceFeedback(result.message.slice(0, 500))
        continue
      }
      if (command.type === 'SET_PROFILE_FIELD' || command.type === 'ADD_SKILL' || command.type === 'REMOVE_SKILL') {
        speakVoiceFeedback('Your profile is not editable on this screen. Say edit my profile to open it.')
        continue
      }
      if (command.type === 'SET_APPLICATION_FIELD') {
        speakVoiceFeedback('There is no job application form open on this screen. Nothing was changed.')
        continue
      }
      if (command.type === 'SAVE_PROFILE') {
        speakVoiceFeedback('Open edit profile to review and save your profile.')
        continue
      }
      if (command.type === 'CONSEQUENTIAL_ACTION') {
        speakVoiceFeedback(`I cannot perform ${command.action} from the assistant. Nothing was submitted or deleted.`)
        continue
      }
      if (command.type === 'CONFIRM' || command.type === 'REJECT') {
        speakVoiceFeedback('There is no action waiting for confirmation.')
        continue
      }
      if (command.type === 'UNKNOWN') {
        speakVoiceFeedback('I did not understand. Say help to hear available commands.')
      }
    }
  }

  const handleVoiceTranscript = async (transcript: string) => {
    const commands = parseVoiceCommand(transcript)
    if (window.speechSynthesis?.speaking && commands.some((command) =>
      command.type !== 'STOP'
      && command.type !== 'CANCEL'
      && !(command.type === 'SET_VOICE_CONTROL' && !command.enabled))) return
    await handleVoiceCommands(commands)
  }
  const voiceControl = useVoiceControl(handleVoiceTranscript, profileState === 'ready' && savedProfile !== null)
  useEffect(() => {
    setVoiceControlEnabledRef.current = voiceControl.setEnabled
    return () => {
      setVoiceControlEnabledRef.current = null
    }
  }, [voiceControl.setEnabled])

  function openProfileEditor() {
    try {
      window.location.assign(getExtensionPageUrl(`profile-ui/index.html${profileState === 'ready' ? '?mode=edit' : ''}`))
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Could not open your profile.')
      setProfileState('error')
    }
  }

  if (profileState === 'loading') {
    return <main className="app-status ui-card" role="status">Loading your saved profile…</main>
  }

  if (profileState !== 'ready' || !savedProfile) {
    return (
      <main className="app-status ui-card" aria-labelledby="profile-status-title">
        <h1 id="profile-status-title">{profileState === 'missing' ? 'Profile setup needed' : 'Profile unavailable'}</h1>
        <p role={profileState === 'error' ? 'alert' : 'status'}>{profileError}</p>
        <button type="button" className="primary-button" onClick={openProfileEditor}>
          {profileState === 'missing' ? 'Set up profile' : 'Open profile'}
        </button>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div><p className="eyebrow">Accessibility assistant</p><h1>AccessApply</h1></div>
        <div className="header-actions">
          <p className="profile-identity">Profile: <strong>{savedProfile.name}</strong></p>
          <p className="status" aria-live="polite"><span className="status-mark" aria-hidden="true" /><span>{displayStatus}</span></p>
          <button type="button" className="secondary-button edit-profile-button" onClick={openProfileEditor}>Edit Profile</button>
          <button type="button" className="secondary-button voice-toggle" aria-pressed={voiceControl.enabled} disabled={!voiceControl.preferenceLoaded} onClick={() => void voiceControl.setEnabled(!voiceControl.enabled)}>
            Voice control: {voiceControl.preferenceLoaded ? voiceControl.enabled ? 'On' : 'Off' : 'Loading'}
          </button>
        </div>
      </header>

      <div className="voice-status" aria-live="polite" aria-atomic="true">
        <span>{voiceControl.voiceState.message}</span>
        {(voiceControl.voiceState.state === 'permission-required' || voiceControl.voiceState.state === 'error') && voiceControl.enabled && <button type="button" className="tertiary-button" onClick={voiceControl.retry}>Retry voice control</button>}
        {voiceControl.preferenceError && <span role="alert">{voiceControl.preferenceError}</span>}
        {voiceFeedback && <span>{voiceFeedback}</span>}
        {voiceSpeechState === 'unavailable' && <span>Audio responses are unavailable; status messages remain visible and screen-reader accessible.</span>}
      </div>
      <p className="voice-privacy-note voice-privacy-disclosure">Speech is processed by the browser speech service. AccessApply does not store microphone audio.</p>

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
            {modes.map((option) => <label className={mode === option.id ? 'mode-option ui-card selected' : 'mode-option ui-card'} title={option.description} key={option.id}>
              <input {...getFocusProps(`${option.label} mode. ${mode === option.id ? 'Currently selected.' : 'Not selected.'}`)} data-voice-description={`${option.label} mode. ${option.description} ${mode === option.id ? 'Currently selected.' : 'Not selected.'}`} title={option.description} type="radio" name="assistance-mode" value={option.id} checked={mode === option.id} onChange={() => { setMode(option.id); if (preferences.readContentAloud) announce(`${option.label} mode selected.`) }} />
              <span><strong>{option.label}</strong><small>{option.description}</small></span>
            </label>)}
          </div></fieldset>

          <form className="command-form" onSubmit={handleSubmit}><label htmlFor="command">Your request</label>
            <textarea {...getFocusProps('Your request. Text area.')} data-voice-description="Your request. Text area. Enter a command for AccessApply." title="Enter a command for AccessApply" ref={commandInputRef} id="command" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Try: Read the requirements of this job." rows={3} />
            <div className="command-actions"><button {...getFocusProps('Send command button.')} data-voice-description="Send command button. Submits your typed command to AccessApply." title="Send command to AccessApply" className="primary-button" type="submit">Send request</button></div>
          </form>

          <section className="response-panel ui-card" aria-labelledby="response-title"><div className="panel-heading"><div><p className="section-kicker">Agent response</p><h2 id="response-title">What I found</h2></div>{response?.status === 'success' && <span className="response-state">Action completed</span>}</div>
            {status === 'processing' ? <p className="response-message" role="status">Processing your request...</p> : status === 'error' ? <p className="response-message error-message" role="alert">{response?.message ?? 'Something went wrong. Please try again.'}</p> : response ? <><p className="response-message" role="status">{response.message}</p><SpeechControls key={response.message} message={response.message} onStateChange={setSpeechState} speakFocusedControls={preferences.speakFocusedControls} enabled={preferences.readContentAloud} /></> : <div className="empty-response"><p className="response-message muted">Your response will appear here. Start with one of these requests:</p><div className="example-list" aria-label="Example requests">{exampleCommands.map((example) => <button {...getFocusProps(`${example} example command.`)} className="example-button" key={example} type="button" onClick={() => chooseExampleCommand(example)}>{example}</button>)}</div></div>}
          </section>
          {preferences.captions && <Transcript entries={transcript} />}
        </> : activePage === 'accessibility' ? <AccessibilityPage preferences={preferences} onPreferenceChange={updatePreference} speakFocusedControls={preferences.speakFocusedControls} /> : <section aria-labelledby="placeholder-title" className="placeholder-panel ui-card"><p className="section-kicker">Recent activity</p><h2 id="placeholder-title">History is coming next</h2><p className="intro">This first slice keeps the assistant experience focused. The next step will add this view without changing the navigation.</p></section>}
      </main>
    </div>
  )
}

export default App
