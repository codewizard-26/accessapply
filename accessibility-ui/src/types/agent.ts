export type AgentStatus =
  | 'ready'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'waiting'
  | 'completed'
  | 'error'

export type AgentResponse = {
  message: string
  status: 'success' | 'error'
}

export type VoiceState = 'idle' | 'listening' | 'processing' | 'error'

export type SpeechState = 'ready' | 'speaking' | 'paused' | 'stopped'

export type TranscriptEntry = {
  id: number
  speaker: 'user' | 'agent'
  message: string
}
