import type { AccessibilityPreferenceKey, AccessibilityPreferences } from '../types/accessibility'
import { useSpokenFocus } from '../hooks/useSpokenFocus'

type AccessibilitySettingProps = {
  setting: AccessibilityPreferenceKey
  label: string
  description: string
  checked: AccessibilityPreferences[AccessibilityPreferenceKey]
  onChange: (setting: AccessibilityPreferenceKey, checked: boolean) => void
  speakFocusedControls: boolean
}

export function AccessibilitySetting({ setting, label, description, checked, onChange, speakFocusedControls }: AccessibilitySettingProps) {
  const { getFocusProps } = useSpokenFocus(speakFocusedControls)
  const descriptionId = `accessibility-${setting}-description`
  const voiceDescription = `${label}. Checkbox. Currently ${checked ? 'enabled' : 'disabled'}. ${description}`

  return (
    <label className="accessibility-setting ui-card" title={`${description} Currently ${checked ? 'enabled' : 'disabled'}.`}>
      <span className="setting-copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span className="setting-control">
        <input
          {...getFocusProps(voiceDescription)}
          aria-describedby={descriptionId}
          data-voice-description={voiceDescription}
          title={`${description} Currently ${checked ? 'enabled' : 'disabled'}.`}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(setting, event.target.checked)}
        />
        <span className="setting-state">{checked ? 'Enabled' : 'Disabled'}</span>
      </span>
      <span className="visually-hidden" id={descriptionId}>{description}</span>
    </label>
  )
}
