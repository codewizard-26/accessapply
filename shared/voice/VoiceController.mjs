function getRecognitionConstructor() {
  return globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition
}

export class VoiceController {
  constructor({ onTranscript, onStateChange, language = 'en-US' }) {
    this.onTranscript = onTranscript
    this.onStateChange = onStateChange
    this.language = language
    this.enabled = false
    this.recognition = null
    this.restartTimer = null
    this.restartDelay = 400
    this.startFailures = 0
    this.isStarting = false
    this.isDestroyed = false
    this.isProcessing = false
    this.transcriptQueue = []
    this.state = 'disabled'
  }

  setState(state, message) {
    this.state = state
    this.onStateChange({ state, message })
  }

  start() {
    if (this.isDestroyed || this.enabled) return
    this.enabled = true
    this.restartDelay = 400
    this.startFailures = 0

    const Recognition = getRecognitionConstructor()
    if (!Recognition) {
      this.setState('error', 'Voice recognition is not supported in this browser. You can continue using the controls.')
      return
    }

    if (!this.recognition) {
      try {
        this.recognition = new Recognition()
      } catch {
        this.enabled = false
        this.setState('error', 'Voice recognition could not be initialized. You can continue using the controls.')
        return
      }
      this.recognition.lang = this.language
      this.recognition.continuous = true
      this.recognition.interimResults = false
      this.recognition.onstart = () => {
        this.isStarting = false
        this.startFailures = 0
        this.restartDelay = 400
        if (this.enabled) this.setState('listening', 'Listening for a command.')
      }
      this.recognition.onresult = (event) => {
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index]
          if (result.isFinal && result[0]?.transcript) this.transcriptQueue.push(result[0].transcript.trim())
        }
        if (this.transcriptQueue.length) this.recognition.stop()
        void this.processNextTranscript()
      }
      this.recognition.onerror = (event) => {
        this.isStarting = false
        if (!this.enabled || event.error === 'aborted') return
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          this.enabled = false
          this.setState('permission-required', 'Allow microphone access in Chrome, then choose Retry voice control. Voice and manual controls remain available.')
          return
        }
        if (event.error === 'audio-capture') {
          this.enabled = false
          this.setState('error', 'No microphone is available. Connect or enable a microphone, then retry voice control.')
          return
        }
        if (event.error === 'network') {
          this.enabled = false
          this.setState('error', 'Speech recognition could not connect. Check your connection, then choose Retry voice control.')
          return
        }
        this.setState('error', 'I did not hear a clear command. Listening will resume automatically.')
      }
      this.recognition.onend = () => {
        this.isStarting = false
        if (this.enabled && !this.isProcessing) this.scheduleRestart()
      }
    }

    this.startRecognition()
  }

  async processNextTranscript() {
    if (this.isProcessing || !this.enabled) return
    const transcript = this.transcriptQueue.shift()
    if (!transcript) return

    this.isProcessing = true
    this.setState('processing', 'Understanding your command.')
    try {
      await this.onTranscript(transcript)
    } catch {
      this.setState('error', 'I could not process that command. Please try again.')
    } finally {
      this.isProcessing = false
      if (!this.enabled) return
      if (this.transcriptQueue.length) {
        void this.processNextTranscript()
      } else {
        this.scheduleRestart()
      }
    }
  }

  startRecognition() {
    if (!this.enabled || !this.recognition || this.isStarting || this.isDestroyed) return
    this.clearRestartTimer()
    this.isStarting = true
    try {
      this.recognition.start()
    } catch {
      this.isStarting = false
      this.startFailures += 1
      if (this.startFailures >= 5) {
        this.enabled = false
        this.setState('error', 'Voice recognition could not restart. Choose Retry voice control or continue using the controls.')
        return
      }
      this.scheduleRestart()
    }
  }

  scheduleRestart() {
    if (!this.enabled || this.restartTimer || this.isDestroyed) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.startRecognition()
    }, this.restartDelay)
    this.restartDelay = Math.min(this.restartDelay * 2, 5000)
  }

  clearRestartTimer() {
    if (!this.restartTimer) return
    clearTimeout(this.restartTimer)
    this.restartTimer = null
  }

  stop() {
    this.enabled = false
    this.clearRestartTimer()
    if (this.recognition) {
      this.recognition.onend = null
      this.recognition.onerror = null
      this.recognition.onresult = null
      try {
        this.recognition.abort()
      } catch {
        this.recognition = null
      }
    }
    this.recognition = null
    this.isStarting = false
    this.isProcessing = false
    this.transcriptQueue = []
    this.setState('disabled', 'Voice control is off. Use the Voice Control toggle to enable it.')
  }

  retry() {
    this.enabled = false
    this.clearRestartTimer()
    if (this.recognition) {
      this.recognition.onend = null
      this.recognition.onerror = null
      this.recognition.onresult = null
      try {
        this.recognition.abort()
      } catch {
        this.recognition = null
      }
    }
    this.recognition = null
    this.isStarting = false
    this.isProcessing = false
    this.transcriptQueue = []
    this.start()
  }

  destroy() {
    this.stop()
    this.isDestroyed = true
  }
}
