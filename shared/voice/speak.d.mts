export type SpeechFeedbackState = 'speaking' | 'ready' | 'error' | 'unavailable'
export function stopSpeaking(): void
export function speakText(text: string, onStateChange?: (state: SpeechFeedbackState) => void): boolean
