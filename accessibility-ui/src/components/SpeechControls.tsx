import { useState } from 'react'
import type { SpeechState } from '../types/agent'

type SpeechControlsProps = {
  message: string
  onStateChange?: (state: SpeechState) => void
}

const stateLabels: Record<SpeechState, string> = {
  ready: 'Ready to read',
  speaking: 'Reading aloud...',
  paused: 'Reading paused',
  stopped: 'Reading stopped',
}

export function SpeechControls({ message, onStateChange }: SpeechControlsProps) {
  const [state, setState] = useState<SpeechState>('ready')
  const updateState = (nextState: SpeechState) => {
    setState(nextState)
    onStateChange?.(nextState)
  }

  return (
    <div className="speech-controls" aria-label="Read response aloud">
      <span className="speech-status" aria-live="polite">{stateLabels[state]}</span>
      <div className="speech-actions">
        <button type="button" className="tertiary-button" onClick={() => updateState('speaking')} disabled={!message || state === 'speaking'}>
          Play
        </button>
        <button type="button" className="tertiary-button" onClick={() => updateState('paused')} disabled={state !== 'speaking'}>
          Pause
        </button>
        <button type="button" className="tertiary-button" onClick={() => updateState('stopped')} disabled={state === 'ready' || state === 'stopped'}>
          Stop
        </button>
        <button type="button" className="tertiary-button" onClick={() => updateState('speaking')} disabled={!message}>
          Replay
        </button>
      </div>
    </div>
  )
}
