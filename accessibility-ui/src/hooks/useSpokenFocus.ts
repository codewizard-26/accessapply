import { useCallback, useEffect, useState } from 'react'

type FocusAnnouncement = string

type FocusProps = {
  onFocus: () => void
}

function supportsSpeechSynthesis() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

let activeAnnouncement: SpeechSynthesisUtterance | null = null
let activeOwner: object | null = null

export function useSpokenFocus(enabled: boolean) {
  const [owner] = useState<object>(() => ({}))

  const announce = useCallback((message: string, interrupt = false) => {
    if (!supportsSpeechSynthesis() || !message.trim()) return

    const synthesis = window.speechSynthesis
    const hasActiveAnnouncement = activeAnnouncement !== null

    if (synthesis.speaking && !hasActiveAnnouncement && !interrupt) return

    synthesis.cancel()
    activeAnnouncement = null
    activeOwner = null
    const utterance = new SpeechSynthesisUtterance(message)
    activeAnnouncement = utterance
    activeOwner = owner
    utterance.onend = () => {
      if (activeAnnouncement === utterance) {
        activeAnnouncement = null
        activeOwner = null
      }
    }
    utterance.onerror = () => {
      if (activeAnnouncement === utterance) {
        activeAnnouncement = null
        activeOwner = null
      }
    }
    synthesis.speak(utterance)
  }, [owner])

  const getFocusProps = useCallback((message: FocusAnnouncement): FocusProps => ({
    onFocus: () => {
      if (enabled) announce(message)
    },
  }), [announce, enabled])

  useEffect(() => {
    return () => {
      if (activeOwner === owner && activeAnnouncement && supportsSpeechSynthesis()) {
        activeAnnouncement = null
        activeOwner = null
        window.speechSynthesis.cancel()
      }
    }
  }, [owner])

  return { announce, getFocusProps }
}
