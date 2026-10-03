export const PROFILE_STORAGE_KEY = 'accessapply.profile'
export const VOICE_CONTROL_STORAGE_KEY = 'accessapply.voiceControlEnabled'

export class ProfileStorageError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'ProfileStorageError'
  }
}

export class ProfileValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProfileValidationError'
  }
}

function getChromeApi() {
  const chromeApi = globalThis.chrome
  if (!chromeApi?.storage?.local) {
    throw new ProfileStorageError('Open AccessApply from the Chrome extension to access saved profile data.')
  }
  return chromeApi
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value, label) {
  if (typeof value !== 'string') {
    throw new ProfileValidationError(`${label} must be text.`)
  }
}

function normalizeProfile(value) {
  if (!isRecord(value)) {
    throw new ProfileValidationError('The saved profile has an invalid format.')
  }

  const profile = value
  requireString(profile.name, 'Name')
  requireString(profile.email, 'Email')
  requireString(profile.phone, 'Phone')
  requireString(profile.location, 'Location')
  if (!profile.name.trim()) {
    throw new ProfileValidationError('Enter your name before saving.')
  }
  if (!/^\S+@\S+\.\S+$/.test(profile.email.trim())) {
    throw new ProfileValidationError('Enter a valid email address before saving.')
  }
  if (!Array.isArray(profile.skills) || !Array.isArray(profile.education) || !Array.isArray(profile.experience)) {
    throw new ProfileValidationError('The saved profile is missing valid skills, education, or experience data.')
  }

  for (const skill of profile.skills) {
    requireString(skill, 'Skill')
  }
  for (const education of profile.education) {
    if (!isRecord(education)) {
      throw new ProfileValidationError('The saved education data has an invalid format.')
    }
    requireString(education.id, 'Education ID')
    requireString(education.institution, 'Institution')
    requireString(education.degree, 'Degree')
    requireString(education.field, 'Field of study')
    if (typeof education.startYear !== 'number' || (education.endYear !== undefined && typeof education.endYear !== 'number')) {
      throw new ProfileValidationError('The saved education dates have an invalid format.')
    }
  }
  for (const experience of profile.experience) {
    if (!isRecord(experience)) {
      throw new ProfileValidationError('The saved experience data has an invalid format.')
    }
    for (const key of ['id', 'company', 'role', 'description', 'startDate']) {
      requireString(experience[key], `Experience ${key}`)
    }
    if (experience.endDate !== undefined) {
      requireString(experience.endDate, 'Experience end date')
    }
  }

  for (const key of ['resume', 'github', 'linkedin']) {
    if (profile[key] !== undefined) {
      requireString(profile[key], key)
    }
  }

  const preferences = profile.accessibilityPreferences
  if (!isRecord(preferences) || ['highContrast', 'reducedMotion', 'largeText'].some((key) => typeof preferences[key] !== 'boolean')) {
    throw new ProfileValidationError('The saved accessibility preferences have an invalid format.')
  }

  return {
    name: profile.name.trim(),
    email: profile.email.trim(),
    phone: profile.phone,
    location: profile.location,
    skills: [...profile.skills],
    education: profile.education.map((education) => ({
      id: education.id,
      institution: education.institution,
      degree: education.degree,
      field: education.field,
      startYear: education.startYear,
      ...(education.endYear !== undefined ? { endYear: education.endYear } : {}),
    })),
    experience: profile.experience.map((experience) => ({
      id: experience.id,
      company: experience.company,
      role: experience.role,
      description: experience.description,
      startDate: experience.startDate,
      ...(experience.endDate !== undefined ? { endDate: experience.endDate } : {}),
    })),
    ...(profile.resume !== undefined ? { resume: profile.resume } : {}),
    ...(profile.github !== undefined ? { github: profile.github } : {}),
    ...(profile.linkedin !== undefined ? { linkedin: profile.linkedin } : {}),
    accessibilityPreferences: {
      highContrast: preferences.highContrast,
      reducedMotion: preferences.reducedMotion,
      largeText: preferences.largeText,
    },
  }
}

function normalizeProfileState(value) {
  if (!isRecord(value)
    || typeof value.profileCompleted !== 'boolean'
    || typeof value.updatedAt !== 'string'
    || Number.isNaN(Date.parse(value.updatedAt))) {
    throw new ProfileStorageError('The saved profile record is invalid. It was not changed.')
  }
  const profile = value.profile === undefined ? undefined : normalizeProfile(value.profile)
  if (value.profileCompleted && !profile) {
    throw new ProfileStorageError('The profile is marked complete but its data is missing. It was not changed.')
  }
  return {
    ...(profile ? { profile } : {}),
    profileCompleted: value.profileCompleted,
    updatedAt: value.updatedAt,
  }
}

async function readProfileState() {
  const chromeApi = getChromeApi()
  try {
    const result = await chromeApi.storage.local.get(PROFILE_STORAGE_KEY)
    const state = result[PROFILE_STORAGE_KEY]
    return state === undefined ? null : normalizeProfileState(state)
  } catch (error) {
    if (error instanceof ProfileStorageError || error instanceof ProfileValidationError) {
      throw error
    }
    throw new ProfileStorageError('Could not read the saved profile. Please try again.', { cause: error })
  }
}

export async function getProfileState() {
  return readProfileState()
}

export async function getProfile() {
  const state = await readProfileState()
  return state?.profile ?? null
}

export async function hasCompletedProfile() {
  const state = await readProfileState()
  return state?.profileCompleted === true
}

export async function getStartupDestination() {
  const state = await readProfileState()
  return state?.profileCompleted === true
    ? 'accessibility-ui/index.html'
    : 'profile-ui/index.html'
}

export async function saveProfile(profile) {
  const normalizedProfile = normalizeProfile(profile)
  const state = {
    profile: normalizedProfile,
    profileCompleted: true,
    updatedAt: new Date().toISOString(),
  }
  const chromeApi = getChromeApi()
  try {
    await chromeApi.storage.local.set({ [PROFILE_STORAGE_KEY]: state })
    return state
  } catch (error) {
    throw new ProfileStorageError('Could not save your profile. Your changes have not been saved.', { cause: error })
  }
}

export async function updateProfile(updates) {
  const state = await readProfileState()
  if (!state?.profile || !state.profileCompleted) {
    throw new ProfileStorageError('There is no saved profile to update.')
  }
  return saveProfile({ ...state.profile, ...updates })
}

export async function clearProfile() {
  const chromeApi = getChromeApi()
  try {
    await chromeApi.storage.local.remove(PROFILE_STORAGE_KEY)
  } catch (error) {
    throw new ProfileStorageError('Could not clear the saved profile. Please try again.', { cause: error })
  }
}

export async function getVoiceControlEnabled() {
  const chromeApi = getChromeApi()
  try {
    const result = await chromeApi.storage.local.get(VOICE_CONTROL_STORAGE_KEY)
    const value = result[VOICE_CONTROL_STORAGE_KEY]
    if (value === undefined) return true
    if (typeof value !== 'boolean') {
      throw new ProfileStorageError('The saved voice-control preference is invalid.')
    }
    return value
  } catch (error) {
    if (error instanceof ProfileStorageError) throw error
    throw new ProfileStorageError('Could not read your voice-control preference. Please try again.', { cause: error })
  }
}

export async function setVoiceControlEnabled(enabled) {
  if (typeof enabled !== 'boolean') {
    throw new ProfileValidationError('Voice control must be enabled or disabled.')
  }
  const chromeApi = getChromeApi()
  try {
    await chromeApi.storage.local.set({ [VOICE_CONTROL_STORAGE_KEY]: enabled })
  } catch (error) {
    throw new ProfileStorageError('Could not save your voice-control preference. Please try again.', { cause: error })
  }
}

export function subscribeToVoiceControlChanges(onChange, onError) {
  const chromeApi = getChromeApi()
  const listener = (changes, areaName) => {
    if (areaName !== 'local' || !Object.hasOwn(changes, VOICE_CONTROL_STORAGE_KEY)) return
    const value = changes[VOICE_CONTROL_STORAGE_KEY]?.newValue
    if (typeof value !== 'boolean') {
      onError(new ProfileStorageError('The updated voice-control preference is invalid.'))
      return
    }
    onChange(value)
  }
  chromeApi.storage.onChanged.addListener(listener)
  return () => chromeApi.storage.onChanged.removeListener(listener)
}

export function getExtensionPageUrl(path) {
  const chromeApi = getChromeApi()
  if (!chromeApi.runtime?.getURL) {
    throw new ProfileStorageError('The AccessApply extension could not open the requested page.')
  }
  return chromeApi.runtime.getURL(path)
}

export function subscribeToProfileChanges(onChange, onError) {
  const chromeApi = getChromeApi()
  const listener = (changes, areaName) => {
    if (areaName !== 'local' || !Object.hasOwn(changes, PROFILE_STORAGE_KEY)) {
      return
    }
    try {
      const newValue = changes[PROFILE_STORAGE_KEY]?.newValue
      onChange(newValue === undefined ? null : normalizeProfileState(newValue))
    } catch (error) {
      onError(error instanceof Error ? error : new ProfileStorageError('The updated profile could not be read.'))
    }
  }
  chromeApi.storage.onChanged.addListener(listener)
  return () => chromeApi.storage.onChanged.removeListener(listener)
}
