export type AccessibilityPreferences = {
  voiceCommands: boolean
  readContentAloud: boolean
  textOnlyMode: boolean
  captions: boolean
  simplifiedLanguage: boolean
  keyboardFirstNavigation: boolean
  stepByStepGuidance: boolean
  reducedVisualClutter: boolean
}

export type AccessibilityPreferenceKey = keyof AccessibilityPreferences
