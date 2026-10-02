import type { AccessibilityPreferenceKey, AccessibilityPreferences } from '../types/accessibility'

type AccessibilitySettingProps = {
  setting: AccessibilityPreferenceKey
  label: string
  description: string
  checked: AccessibilityPreferences[AccessibilityPreferenceKey]
  onChange: (setting: AccessibilityPreferenceKey, checked: boolean) => void
}

export function AccessibilitySetting({ setting, label, description, checked, onChange }: AccessibilitySettingProps) {
  return (
    <label className="accessibility-setting">
      <span className="setting-copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span className="setting-control">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(setting, event.target.checked)}
        />
        <span className="setting-state">{checked ? 'Enabled' : 'Disabled'}</span>
      </span>
    </label>
  )
}
