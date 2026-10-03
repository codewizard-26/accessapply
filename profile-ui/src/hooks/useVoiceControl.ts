import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getVoiceControlEnabled,
  setVoiceControlEnabled,
  subscribeToVoiceControlChanges,
} from '../../../shared/profile/profileStorage.mjs'
import { VoiceController } from '../../../shared/voice/VoiceController.mjs'
import type { VoiceControllerState } from '../../../shared/voice/VoiceController.mjs'
import { speakText, stopSpeaking } from '../../../shared/voice/speak.mjs'

type VoiceState = {
  state: VoiceControllerState | 'loading'
  message: string
}

export function useVoiceControl(onTranscript: (transcript: string) => void | Promise<void>, active = true) {
  const [enabled, setEnabledState] = useState(false)
  const [preferenceLoaded, setPreferenceLoaded] = useState(false)
  const [voiceState, setVoiceState] = useState<VoiceState>({ state: 'loading', message: 'Checking voice-control preference.' })
  const [preferenceError, setPreferenceError] = useState('')
  const controllerRef = useRef<VoiceController | null>(null)
  const transcriptHandlerRef = useRef(onTranscript)
  const readyAnnouncedRef = useRef(false)

  useEffect(() => {
    transcriptHandlerRef.current = onTranscript
  }, [onTranscript])

  useEffect(() => {
    if (!active) return
    let isActive = true
    let unsubscribe = () => {}

    const applyPreference = (nextEnabled: boolean) => {
      setPreferenceLoaded(true)
      setEnabledState(nextEnabled)
      if (!nextEnabled) {
        controllerRef.current?.stop()
        setVoiceState({ state: 'disabled', message: 'Voice control is off. Turn it on here using the keyboard or mouse.' })
        return
      }
      if (!controllerRef.current) {
        controllerRef.current = new VoiceController({
          onTranscript: (transcript) => transcriptHandlerRef.current(transcript),
          onStateChange: (nextState) => {
            if (!isActive) return
            setVoiceState(nextState)
            if (nextState.state === 'listening' && !readyAnnouncedRef.current) {
              readyAnnouncedRef.current = true
              window.setTimeout(() => {
                if (isActive) speakText('AccessApply voice control is ready. You can speak a command.')
              }, 250)
            }
          },
        })
      }
      controllerRef.current.start()
    }

    getVoiceControlEnabled()
      .then((storedEnabled) => {
        if (!isActive) return
        applyPreference(storedEnabled)
        setPreferenceError('')
        try {
          unsubscribe = subscribeToVoiceControlChanges(
            (changedEnabled) => {
              if (isActive) applyPreference(changedEnabled)
            },
            (error) => {
              if (isActive) setPreferenceError(error.message)
            },
          )
        } catch (error) {
          setPreferenceError(error instanceof Error ? error.message : 'Voice-control preference updates are unavailable.')
        }
      })
      .catch((error: unknown) => {
        if (!isActive) return
        setPreferenceLoaded(true)
        setEnabledState(false)
        setVoiceState({ state: 'error', message: error instanceof Error ? error.message : 'Voice-control preference could not be loaded.' })
        setPreferenceError(error instanceof Error ? error.message : 'Voice-control preference could not be loaded.')
      })

    return () => {
      isActive = false
      unsubscribe()
      controllerRef.current?.destroy()
      controllerRef.current = null
    }
  }, [active])

  const setEnabled = useCallback(async (nextEnabled: boolean) => {
    setPreferenceError('')
    try {
      await setVoiceControlEnabled(nextEnabled)
    } catch (error) {
      setPreferenceError(error instanceof Error ? error.message : 'Could not save your voice-control preference.')
      return false
    }
    setPreferenceLoaded(true)
    setEnabledState(nextEnabled)
    if (!nextEnabled) {
      controllerRef.current?.stop()
      stopSpeaking()
      setVoiceState({ state: 'disabled', message: 'Voice control is off. Turn it on here using the keyboard or mouse.' })
    } else {
      readyAnnouncedRef.current = false
      controllerRef.current?.start()
    }
    return true
  }, [])

  const retry = useCallback(() => {
    if (enabled) controllerRef.current?.retry()
  }, [enabled])

  return { enabled, preferenceLoaded, voiceState, preferenceError, setEnabled, retry }
}
