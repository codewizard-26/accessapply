export function stopSpeaking() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}

export function speakText(text, onStateChange = () => {}) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    onStateChange('unavailable')
    return false
  }
  const message = text.trim()
  if (!message) return false

  stopSpeaking()
  const utterance = new SpeechSynthesisUtterance(message)
  utterance.onstart = () => onStateChange('speaking')
  utterance.onend = () => onStateChange('ready')
  utterance.onerror = (event) => {
    onStateChange(event.error === 'canceled' || event.error === 'interrupted' ? 'ready' : 'error')
  }
  window.speechSynthesis.speak(utterance)
  return true
}
