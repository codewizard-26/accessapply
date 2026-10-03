export type VoiceCommand =
  | { type: 'SET_PROFILE_FIELD'; field: 'name' | 'email' | 'phone' | 'location' | 'github' | 'linkedin'; value: string }
  | { type: 'ADD_SKILL'; value: string }
  | { type: 'REMOVE_SKILL'; value: string }
  | { type: 'SET_APPLICATION_FIELD'; field: 'workauthorization' | 'visasponsorship' | 'coverletter'; value: string }
  | { type: 'SAVE_PROFILE' }
  | { type: 'EDIT_PROFILE' }
  | { type: 'NAVIGATE'; destination: 'profile' | 'application' | 'review' }
  | { type: 'NEXT' | 'PREVIOUS' | 'READ_PAGE' | 'READ_FIELD' | 'READ_MISSING' | 'HELP' | 'STOP' | 'CANCEL' | 'CONFIRM' | 'REJECT' | 'UNKNOWN' }
  | { type: 'SET_VOICE_CONTROL'; enabled: boolean }
  | { type: 'ASSISTANT_REQUEST'; command: string }
  | { type: 'CONSEQUENTIAL_ACTION'; action: string }

export function parseVoiceCommand(transcript: string): VoiceCommand[]
