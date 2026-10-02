import { useEffect, useRef, useState } from 'react'
import { useSpokenFocus } from '../hooks/useSpokenFocus'
import type { SpeechState } from '../types/agent'

type SpeechControlsProps = {
  message: string
  onStateChange?: (state: SpeechState) => void
  speakFocusedControls?: boolean
  enabled?: boolean
}

type SpeechUiState = SpeechState | 'unavailable' | 'error'

const stateLabels: Record<SpeechUiState, string> = {
  ready: 'Ready to read',
  speaking: 'Reading aloud...',
  paused: 'Reading paused',
  stopped: 'Reading stopped',
  unavailable: "Text-to-speech isn't available in this browser.",
  error: 'Speech could not be played. Please try again.',
}

function supportsSpeechSynthesis() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

export function SpeechControls({ message, onStateChange, speakFocusedControls = false, enabled = true }: SpeechControlsProps) {
  const [state, setState] = useState<SpeechUiState>(() => supportsSpeechSynthesis() ? 'ready' : 'unavailable')
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const speechSynthesisRef = useRef<SpeechSynthesis | null>(null)
  const activeMessageRef = useRef<string | null>(null)
  const { getFocusProps } = useSpokenFocus(speakFocusedControls)

  const updateState = (nextState: SpeechUiState) => {
    setState(nextState)
    if (nextState === 'ready' || nextState === 'speaking' || nextState === 'paused' || nextState === 'stopped') {
      onStateChange?.(nextState)
    }
  }

  const getSpeechSynthesis = () => {
    if (!supportsSpeechSynthesis()) {
      updateState('unavailable')
      return null
    }

    speechSynthesisRef.current = window.speechSynthesis
    return speechSynthesisRef.current
  }

  const speak = () => {
    const speechSynthesis = getSpeechSynthesis()
    if (!speechSynthesis || !message) return

    if (state === 'paused' && activeMessageRef.current === message && speechSynthesis.paused && utteranceRef.current) {
      speechSynthesis.resume()
      updateState('speaking')
      return
    }

    speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(message)
    utteranceRef.current = utterance
    activeMessageRef.current = message

    utterance.onstart = () => {
      if (utteranceRef.current === utterance) updateState('speaking')
    }
    utterance.onpause = () => {
      if (utteranceRef.current === utterance) updateState('paused')
    }
    utterance.onresume = () => {
      if (utteranceRef.current === utterance) updateState('speaking')
    }
    utterance.onend = () => {
      if (utteranceRef.current === utterance) {
        utteranceRef.current = null
        updateState('ready')
      }
    }
    utterance.onerror = (event) => {
      if (utteranceRef.current !== utterance) return

      utteranceRef.current = null
      if (event.error === 'canceled' || event.error === 'interrupted') {
        updateState('stopped')
      } else {
        updateState('error')
      }
    }

    speechSynthesis.speak(utterance)
    updateState('speaking')
  }

  const pause = () => {
    speechSynthesisRef.current?.pause()
    updateState('paused')
  }

  const stop = () => {
    utteranceRef.current = null
    activeMessageRef.current = null
    speechSynthesisRef.current?.cancel()
    updateState('stopped')
  }

  useEffect(() => {
    if (!enabled) {
      speechSynthesisRef.current?.cancel()
      speechSynthesisRef.current = null
    }
    speechSynthesisRef.current = null

    return () => {
      utteranceRef.current = null
      activeMessageRef.current = null
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [enabled, message])

  const speechAvailable = supportsSpeechSynthesis()
  const visibleState = enabled ? state : 'stopped'
  const canStop = visibleState !== 'ready' && visibleState !== 'stopped' && visibleState !== 'unavailable' && visibleState !== 'error'

  return (
    <div className="speech-controls" aria-label="Read response aloud">
      <span className="speech-status" aria-live="polite" role={visibleState === 'error' || visibleState === 'unavailable' ? 'alert' : undefined}>{enabled ? stateLabels[state] : 'Read content aloud is disabled.'}</span>
      <div className="speech-actions">
        <button {...getFocusProps(visibleState === 'paused' ? 'Resume button. Continues reading the response.' : 'Play button. Reads the response aloud.')} data-voice-description={visibleState === 'paused' ? 'Resume button. Continues reading the response.' : 'Play button. Reads the response aloud.'} title={visibleState === 'paused' ? 'Resume reading aloud' : 'Read response aloud'} type="button" className="tertiary-button" onClick={speak} disabled={!enabled || !message || !speechAvailable || visibleState === 'speaking'}>
          {visibleState === 'paused' ? 'Resume' : 'Play'}
        </button>
        <button {...getFocusProps('Pause button. Pauses reading aloud.')} data-voice-description="Pause button. Pauses reading aloud." title="Pause reading aloud" type="button" className="tertiary-button" onClick={pause} disabled={!enabled || visibleState !== 'speaking'}>
          Pause
        </button>
        <button {...getFocusProps('Stop button. Stops reading aloud.')} data-voice-description="Stop button. Stops reading aloud." title="Stop reading aloud" type="button" className="tertiary-button" onClick={stop} disabled={!enabled || !canStop}>
          Stop
        </button>
        <button {...getFocusProps('Replay button. Reads the response from the beginning.')} data-voice-description="Replay button. Reads the response from the beginning." title="Replay response aloud" type="button" className="tertiary-button" onClick={speak} disabled={!enabled || !message || !speechAvailable}>
          Replay
        </button>
      </div>
    </div>
  )
}
