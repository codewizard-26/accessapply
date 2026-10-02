import { useEffect, useRef, useState } from 'react'
import { useSpokenFocus } from '../hooks/useSpokenFocus'
import type { VoiceState } from '../types/agent'

type SpeechRecognitionResultLike = {
  isFinal: boolean
  0: { transcript: string }
}

type SpeechRecognitionEventLike = Event & {
  resultIndex: number
  results: {
    length: number
    [index: number]: SpeechRecognitionResultLike
  }
}

type SpeechRecognitionErrorEventLike = Event & {
  error: string
}

type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onstart: (() => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

type VoiceCommandProps = {
  state: VoiceState
  onRetry: () => void
  onCommand: (command: string) => void | Promise<void>
  onStateChange: (state: VoiceState) => void
  speakFocusedControls?: boolean
  readContentAloud?: boolean
  disabled?: boolean
}

type VoiceUiState = VoiceState | 'unsupported'

const stateLabels: Record<VoiceUiState, string> = {
  idle: 'Voice command',
  listening: 'Listening... Speak your command.',
  processing: 'Processing voice command...',
  error: "We couldn't process the voice command.",
  unsupported: 'Voice recognition is not supported in this browser.',
}

function getRecognitionConstructor() {
  const speechWindow = window as SpeechRecognitionWindow
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
}

export function VoiceCommand({ state, onRetry, onCommand, onStateChange, speakFocusedControls = false, readContentAloud = true, disabled = false }: VoiceCommandProps) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const stateRef = useRef<VoiceState>(state)
  const mountedRef = useRef(true)
  const [errorMessage, setErrorMessage] = useState('')
  const { announce, getFocusProps } = useSpokenFocus(speakFocusedControls)
  const recognitionConstructor = typeof window === 'undefined' ? undefined : getRecognitionConstructor()
  const supported = Boolean(recognitionConstructor)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    if (!readContentAloud) return
    if (state === 'listening') announce('Listening. Speak your command.', true)
    if (state === 'processing') announce('Processing command.', true)
    if (state === 'error') announce(errorMessage || stateLabels.error, true)
  }, [announce, errorMessage, readContentAloud, state])

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      recognitionRef.current?.abort()
      recognitionRef.current = null
    }
  }, [])

  const updateState = (nextState: VoiceState) => {
    stateRef.current = nextState
    onStateChange(nextState)
  }

  const startRecognition = () => {
    if (disabled || !recognitionConstructor) return

    recognitionRef.current?.abort()
    setErrorMessage('')
    updateState('listening')

    const recognition = new recognitionConstructor()
    let receivedFinalResult = false
    recognition.lang = 'en-US'
    recognition.interimResults = false
    recognition.continuous = false
    recognitionRef.current = recognition

    recognition.onstart = () => {
      if (mountedRef.current) updateState('listening')
    }

    recognition.onresult = async (event) => {
      const command = Array.from({ length: event.results.length - event.resultIndex }, (_, index) => event.results[event.resultIndex + index])
        .filter((result) => result.isFinal)
        .map((result) => result[0].transcript)
        .join(' ')
        .trim()

      if (!command) return

      receivedFinalResult = true
      recognition.stop()
      if (!mountedRef.current) return

      updateState('processing')
      try {
        await onCommand(command)
        if (mountedRef.current) updateState('idle')
      } catch {
        if (mountedRef.current) {
          setErrorMessage("We couldn't process the voice command.")
          updateState('error')
        }
      }
    }

    recognition.onerror = (event) => {
      if (!mountedRef.current || event.error === 'aborted') return

      const message = event.error === 'not-allowed'
        ? 'Microphone permission was not granted. You can continue using typed commands.'
        : event.error === 'no-speech'
          ? 'No speech was recognized. Please try again.'
          : "We couldn't process the voice command. Please try again."
      setErrorMessage(message)
      updateState('error')
    }

    recognition.onend = () => {
      recognitionRef.current = null
      if (mountedRef.current && !receivedFinalResult && stateRef.current === 'listening') {
        setErrorMessage('No speech was recognized. Please try again.')
        updateState('error')
      }
    }

    try {
      recognition.start()
    } catch {
      setErrorMessage("We couldn't start voice recognition. Please try again.")
      updateState('error')
    }
  }

  const stopRecognition = () => {
    recognitionRef.current?.abort()
    recognitionRef.current = null
    updateState('idle')
  }

  if (disabled) {
    return <button {...getFocusProps('Voice commands disabled. Enable Voice commands in Accessibility to use this control.')} data-voice-description="Voice commands disabled. Enable Voice commands in Accessibility to use this control." title="Voice commands are disabled" className="secondary-button" type="button" disabled aria-label="Voice commands are disabled">Voice commands disabled</button>
  }

  if (!supported) {
    return <div className="voice-error" role="status"><span>{stateLabels.unsupported} You can continue using typed commands.</span><button {...getFocusProps('Voice unavailable.')} data-voice-description="Voice unavailable. Continue using typed commands." title="Voice recognition is unavailable" className="tertiary-button" type="button" disabled>Voice unavailable</button></div>
  }

  if (state === 'error') {
    return (
      <div className="voice-error" role="alert" aria-live="assertive">
        <span>{errorMessage || stateLabels[state]}</span>
        <button {...getFocusProps('Try again button. Restarts voice recognition.')} data-voice-description="Try again button. Restarts voice recognition." title="Try voice recognition again" type="button" className="tertiary-button" onClick={() => { onRetry(); setErrorMessage('') }}>Try again</button>
      </div>
    )
  }

  return (
    <div className="voice-actions">
      <button {...getFocusProps('Voice command button. Press to start listening.')} data-voice-description="Voice command button. Press to start listening." title="Start voice command listening" className="secondary-button" type="button" onClick={startRecognition} disabled={state !== 'idle'} aria-label={stateLabels[state]}>
        {stateLabels[state]}
      </button>
      {state === 'listening' && <button {...getFocusProps('Stop listening button. Stops voice recognition.')} data-voice-description="Stop listening button. Stops voice recognition." title="Stop listening" type="button" className="tertiary-button" onClick={stopRecognition}>Stop listening</button>}
    </div>
  )
}
