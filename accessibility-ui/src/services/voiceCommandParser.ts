import type { AccessibilityPreferenceKey } from '../types/accessibility'
import type { AssistanceMode } from '../types/agent'

export type VoiceNavigationTarget = 'assistant' | 'history' | 'accessibility'

export type ParsedVoiceCommand =
  | { type: 'navigate'; page: VoiceNavigationTarget }
  | { type: 'preference'; setting: AccessibilityPreferenceKey; enabled: boolean }
  | { type: 'assistant'; command: string; mode?: AssistanceMode }

const navigationTargets: Array<{ page: VoiceNavigationTarget; aliases: string[] }> = [
  { page: 'accessibility', aliases: ['accessibility', 'accessibility tab', 'accessibility page'] },
  { page: 'assistant', aliases: ['assistant', 'assistant tab', 'assistant page'] },
  { page: 'history', aliases: ['history', 'history tab', 'history page'] },
]

const preferenceTargets: Array<{ setting: AccessibilityPreferenceKey; aliases: string[] }> = [
  { setting: 'voiceCommands', aliases: ['voice commands', 'voice command'] },
  { setting: 'readContentAloud', aliases: ['read content aloud', 'read aloud'] },
  { setting: 'textOnlyMode', aliases: ['text only mode', 'text-only mode', 'text only'] },
  { setting: 'captions', aliases: ['captions', 'caption'] },
  { setting: 'simplifiedLanguage', aliases: ['simplified language', 'simpler language'] },
  { setting: 'keyboardFirstNavigation', aliases: ['keyboard first navigation', 'keyboard-first navigation', 'keyboard navigation'] },
  { setting: 'stepByStepGuidance', aliases: ['step by step guidance', 'step-by-step guidance', 'step by step'] },
  { setting: 'reducedVisualClutter', aliases: ['reduced visual clutter', 'visual clutter'] },
]

function normalizeCommand(command: string) {
  return command.toLowerCase().replace(/[.!?,]/g, '').replace(/\s+/g, ' ').trim()
}

function hasAlias(command: string, aliases: string[]) {
  return aliases.some((alias) => command.includes(alias))
}

function isEnableCommand(command: string) {
  return /\b(enable|turn on|switch on)\b/.test(command)
}

function isDisableCommand(command: string) {
  return /\b(disable|turn off|switch off)\b/.test(command)
}

export function parseVoiceCommand(command: string): ParsedVoiceCommand {
  const normalizedCommand = normalizeCommand(command)

  for (const target of navigationTargets) {
    if (hasAlias(normalizedCommand, target.aliases) && /\b(open|go to|select|show)\b/.test(normalizedCommand)) {
      return { type: 'navigate', page: target.page }
    }
  }

  for (const target of preferenceTargets) {
    if (hasAlias(normalizedCommand, target.aliases)) {
      if (isEnableCommand(normalizedCommand)) {
        return { type: 'preference', setting: target.setting, enabled: true }
      }
      if (isDisableCommand(normalizedCommand)) {
        return { type: 'preference', setting: target.setting, enabled: false }
      }
    }
  }

  return { type: 'assistant', command: command.trim() }
}
