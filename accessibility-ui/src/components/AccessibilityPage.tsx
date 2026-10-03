import { AccessibilitySetting } from './AccessibilitySetting'
import type { AccessibilityPreferenceKey, AccessibilityPreferences } from '../types/accessibility'

type AccessibilityPageProps = {
  preferences: AccessibilityPreferences
  onPreferenceChange: (setting: AccessibilityPreferenceKey, checked: boolean) => void
  speakFocusedControls: boolean
}

const settings: Array<{
  group: 'voice' | 'reading' | 'navigation'
  setting: AccessibilityPreferenceKey
  label: string
  description: string
}> = [
  { group: 'voice', setting: 'voiceCommands', label: 'Voice commands', description: 'Allow AccessApply to receive commands using voice.' },
  { group: 'voice', setting: 'readContentAloud', label: 'Read content aloud', description: 'Make important agent responses available to read aloud.' },
  { group: 'voice', setting: 'captions', label: 'Captions', description: 'Show text transcripts for voice interactions.' },
  { group: 'voice', setting: 'speakFocusedControls', label: 'Speak focused controls', description: 'Hear the name and current state of buttons, tabs, and settings when you move focus to them.' },
  { group: 'reading', setting: 'textOnlyMode', label: 'Text-only mode', description: 'Prioritize text and reduce decorative visual elements.' },
  { group: 'reading', setting: 'simplifiedLanguage', label: 'Simplified language', description: 'Use simpler language when explaining job information.' },
  { group: 'navigation', setting: 'keyboardFirstNavigation', label: 'Keyboard-first navigation', description: 'Optimize interactions for keyboard navigation.' },
  { group: 'navigation', setting: 'stepByStepGuidance', label: 'Step-by-step guidance', description: 'Break complex tasks into smaller steps.' },
  { group: 'navigation', setting: 'reducedVisualClutter', label: 'Reduced visual clutter', description: 'Reduce unnecessary visual elements and distractions.' },
]

const settingGroups: Array<{ id: typeof settings[number]['group']; label: string; description: string }> = [
  { id: 'voice', label: 'Voice & speech', description: 'Choose how AccessApply speaks and listens.' },
  { id: 'reading', label: 'Reading & language', description: 'Adjust how information is presented and explained.' },
  { id: 'navigation', label: 'Navigation & guidance', description: 'Make controls and complex tasks easier to use.' },
]

export function AccessibilityPage({ preferences, onPreferenceChange, speakFocusedControls }: AccessibilityPageProps) {
  return (
    <section aria-labelledby="accessibility-title">
      <p className="section-kicker">Your preferences</p>
      <h2 id="accessibility-title">Accessibility</h2>
      <p className="intro">Customize how AccessApply communicates and assists you.</p>

      <fieldset className="accessibility-preferences">
        <legend className="visually-hidden">Accessibility preferences</legend>
        {settingGroups.map((group) => (
          <section className="setting-group" key={group.id} aria-labelledby={`${group.id}-settings-title`}>
            <h3 id={`${group.id}-settings-title`}>{group.label}</h3>
            <p>{group.description}</p>
            <div className="settings-list">
              {settings.filter((setting) => setting.group === group.id).map((setting) => (
                <AccessibilitySetting
                  key={setting.setting}
                  {...setting}
                  checked={preferences[setting.setting]}
                  onChange={onPreferenceChange}
                  speakFocusedControls={speakFocusedControls}
                />
              ))}
            </div>
          </section>
        ))}
      </fieldset>
    </section>
  )
}
