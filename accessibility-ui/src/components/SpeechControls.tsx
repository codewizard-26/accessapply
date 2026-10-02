import { useEffect, useRef, useState } from 'react'
import type { SpeechState } from '../types/agent'

type SpeechControlsProps = {
  message: string
  onStateChange?: (state: SpeechState) => void
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

export function SpeechControls({ message, onStateChange }: SpeechControlsProps) {
  const [state, setState] = useState<SpeechUiState>(() => supportsSpeechSynthesis() ? 'ready' : 'unavailable')
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const speechSynthesisRef = useRef<SpeechSynthesis | null>(null)
  const activeMessageRef = useRef<string | null>(null)

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
    speechSynthesisRef.current = null

    return () => {
      utteranceRef.current = null
      activeMessageRef.current = null
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [message])

  const speechAvailable = supportsSpeechSynthesis()
  const canStop = state !== 'ready' && state !== 'stopped' && state !== 'unavailable' && state !== 'error'

  return (
    <div className="speech-controls" aria-label="Read response aloud">
      <span className="speech-status" aria-live="polite" role={state === 'error' || state === 'unavailable' ? 'alert' : undefined}>{stateLabels[state]}</span>
      <div className="speech-actions">
        <button type="button" className="tertiary-button" onClick={speak} disabled={!message || !speechAvailable || state === 'speaking'}>
          {state === 'paused' ? 'Resume' : 'Play'}
        </button>
        <button type="button" className="tertiary-button" onClick={pause} disabled={state !== 'speaking'}>
          Pause
        </button>
        <button type="button" className="tertiary-button" onClick={stop} disabled={!canStop}>
          Stop
        </button>
        <button type="button" className="tertiary-button" onClick={speak} disabled={!message || !speechAvailable}>
          Replay
        </button>
      </div>
    </div>
  )
}
