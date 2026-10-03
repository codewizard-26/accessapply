export type VoiceControllerState =
  | 'disabled'
  | 'listening'
  | 'processing'
  | 'error'
  | 'permission-required'

export interface VoiceControllerOptions {
  onTranscript: (transcript: string) => void | Promise<void>
  onStateChange: (state: { state: VoiceControllerState; message: string }) => void
  language?: string
}

export class VoiceController {
  constructor(options: VoiceControllerOptions)
  readonly state: VoiceControllerState
  start(): void
  stop(): void
  retry(): void
  destroy(): void
}
