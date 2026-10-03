import type { UserProfile } from '../types/profile.js'

export interface ProfileState {
  profile?: UserProfile
  profileCompleted: boolean
  updatedAt: string
}

export class ProfileStorageError extends Error {}
export class ProfileValidationError extends Error {}

export const PROFILE_STORAGE_KEY: string
export const VOICE_CONTROL_STORAGE_KEY: string

export function getProfileState(): Promise<ProfileState | null>
export function getProfile(): Promise<UserProfile | null>
export function hasCompletedProfile(): Promise<boolean>
export function getStartupDestination(): Promise<'profile-ui/index.html' | 'accessibility-ui/index.html'>
export function saveProfile(profile: UserProfile): Promise<ProfileState>
export function updateProfile(updates: Partial<UserProfile>): Promise<ProfileState>
export function clearProfile(): Promise<void>
export function getVoiceControlEnabled(): Promise<boolean>
export function setVoiceControlEnabled(enabled: boolean): Promise<void>
export function subscribeToVoiceControlChanges(
  onChange: (enabled: boolean) => void,
  onError: (error: Error) => void,
): () => void
export function getExtensionPageUrl(path: string): string
export function subscribeToProfileChanges(
  onChange: (state: ProfileState | null) => void,
  onError: (error: Error) => void,
): () => void
