import { AccessibilitySetting } from './AccessibilitySetting'
import type { AccessibilityPreferenceKey, AccessibilityPreferences } from '../types/accessibility'

type AccessibilityPageProps = {
  preferences: AccessibilityPreferences
  onPreferenceChange: (setting: AccessibilityPreferenceKey, checked: boolean) => void
}

const settings: Array<{
  setting: AccessibilityPreferenceKey
  label: string
  description: string
}> = [
  { setting: 'voiceCommands', label: 'Voice commands', description: 'Allow AccessApply to receive commands using voice.' },
  { setting: 'readContentAloud', label: 'Read content aloud', description: 'Make important agent responses available to read aloud.' },
  { setting: 'textOnlyMode', label: 'Text-only mode', description: 'Prioritize text and reduce decorative visual elements.' },
  { setting: 'captions', label: 'Captions', description: 'Show text transcripts for voice interactions.' },
  { setting: 'simplifiedLanguage', label: 'Simplified language', description: 'Use simpler language when explaining job information.' },
  { setting: 'keyboardFirstNavigation', label: 'Keyboard-first navigation', description: 'Optimize interactions for keyboard navigation.' },
  { setting: 'stepByStepGuidance', label: 'Step-by-step guidance', description: 'Break complex tasks into smaller steps.' },
  { setting: 'reducedVisualClutter', label: 'Reduced visual clutter', description: 'Reduce unnecessary visual elements and distractions.' },
]

export function AccessibilityPage({ preferences, onPreferenceChange }: AccessibilityPageProps) {
  return (
    <section aria-labelledby="accessibility-title">
      <p className="section-kicker">Your preferences</p>
      <h2 id="accessibility-title">Accessibility</h2>
      <p className="intro">Customize how AccessApply communicates and assists you.</p>

      <fieldset className="accessibility-preferences">
        <legend className="visually-hidden">Accessibility preferences</legend>
        <div className="settings-list">
          {settings.map((setting) => (
            <AccessibilitySetting
              key={setting.setting}
              {...setting}
              checked={preferences[setting.setting]}
              onChange={onPreferenceChange}
            />
          ))}
        </div>
      </fieldset>
    </section>
  )
}
