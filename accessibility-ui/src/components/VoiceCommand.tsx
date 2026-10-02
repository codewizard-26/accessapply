import type { VoiceState } from '../types/agent'

type VoiceCommandProps = {
  state: VoiceState
  onStart: () => void
  onRetry: () => void
  disabled?: boolean
}

const stateLabels: Record<VoiceState, string> = {
  idle: 'Voice command',
  listening: 'Listening...',
  processing: 'Processing voice command...',
  error: "We couldn't process the voice command.",
}

export function VoiceCommand({ state, onStart, onRetry, disabled = false }: VoiceCommandProps) {
  if (disabled) {
    return <button className="secondary-button" type="button" disabled aria-label="Voice commands are disabled">Voice commands disabled</button>
  }

  if (state === 'error') {
    return (
      <div className="voice-error" role="alert">
        <span>{stateLabels[state]}</span>
        <button type="button" className="tertiary-button" onClick={onRetry}>Try again</button>
      </div>
    )
  }

  return (
    <button className="secondary-button" type="button" onClick={onStart} disabled={state !== 'idle'} aria-label={stateLabels[state]}>
      {stateLabels[state]}
    </button>
  )
}
