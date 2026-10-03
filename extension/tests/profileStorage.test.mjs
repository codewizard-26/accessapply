import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import {
  clearProfile,
  getProfile,
  getProfileState,
  getStartupDestination,
  getVoiceControlEnabled,
  hasCompletedProfile,
  PROFILE_STORAGE_KEY,
  ProfileStorageError,
  ProfileValidationError,
  saveProfile,
  setVoiceControlEnabled,
  subscribeToVoiceControlChanges,
  subscribeToProfileChanges,
  updateProfile,
} from '../../shared/profile/profileStorage.mjs'

const sampleProfile = {
  name: 'Taylor Example',
  email: 'taylor@example.com',
  phone: '',
  location: '',
  skills: ['Accessible design'],
  education: [],
  experience: [],
  accessibilityPreferences: {
    highContrast: false,
    reducedMotion: false,
    largeText: false,
  },
}

let records
let listeners
let shouldFailRead
let shouldFailWrite

beforeEach(() => {
  records = {}
  listeners = new Set()
  shouldFailRead = false
  shouldFailWrite = false
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          if (shouldFailRead) throw new Error('Read rejected')
          return Object.hasOwn(records, key) ? { [key]: records[key] } : {}
        },
        async set(values) {
          if (shouldFailWrite) throw new Error('Write rejected')
          const changes = {}
          for (const [key, value] of Object.entries(values)) {
            const oldValue = records[key]
            records[key] = value
            changes[key] = { oldValue, newValue: value }
          }
          for (const listener of listeners) listener(changes, 'local')
        },
        async remove(key) {
          const oldValue = records[key]
          delete records[key]
          for (const listener of listeners) listener({ [key]: { oldValue } }, 'local')
        },
      },
      onChanged: {
        addListener(listener) {
          listeners.add(listener)
        },
        removeListener(listener) {
          listeners.delete(listener)
        },
      },
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`
      },
    },
  }
})

afterEach(() => {
  delete globalThis.chrome
})

test('a missing profile remains incomplete', async () => {
  assert.equal(await getProfileState(), null)
  assert.equal(await getProfile(), null)
  assert.equal(await hasCompletedProfile(), false)
  assert.equal(await getStartupDestination(), 'profile-ui/index.html')
})

test('an incomplete stored profile routes to onboarding', async () => {
  records[PROFILE_STORAGE_KEY] = {
    profileCompleted: false,
    updatedAt: new Date().toISOString(),
  }
  assert.equal(await hasCompletedProfile(), false)
  assert.equal(await getStartupDestination(), 'profile-ui/index.html')
})

test('saving persists one completed profile and reports changes', async () => {
  let notifiedState = null
  const unsubscribe = subscribeToProfileChanges((state) => {
    notifiedState = state
  }, (error) => {
    throw error
  })

  const savedState = await saveProfile(sampleProfile)
  assert.equal(savedState.profileCompleted, true)
  assert.equal((await getProfileState())?.profile?.name, sampleProfile.name)
  assert.equal(await hasCompletedProfile(), true)
  assert.equal(await getStartupDestination(), 'accessibility-ui/index.html')
  assert.deepEqual(notifiedState, savedState)

  const updatedState = await updateProfile({ phone: '555-0100' })
  assert.equal(updatedState.profile?.phone, '555-0100')
  assert.equal(updatedState.profile?.email, sampleProfile.email)
  unsubscribe()
})

test('invalid profile data does not create or overwrite a completed profile', async () => {
  await assert.rejects(saveProfile({ ...sampleProfile, email: 'not-an-email' }), ProfileValidationError)
  assert.equal(await hasCompletedProfile(), false)

  await saveProfile(sampleProfile)
  await assert.rejects(saveProfile({ ...sampleProfile, name: '' }), ProfileValidationError)
  assert.equal((await getProfile())?.name, sampleProfile.name)
  assert.equal(await hasCompletedProfile(), true)
})

test('malformed stored data is reported and not treated as an empty profile', async () => {
  records[PROFILE_STORAGE_KEY] = { profileCompleted: true, profile: {}, updatedAt: new Date().toISOString() }
  await assert.rejects(getProfileState(), ProfileValidationError)

  records[PROFILE_STORAGE_KEY] = { profileCompleted: false, updatedAt: 'invalid' }
  await assert.rejects(getProfileState(), ProfileStorageError)
})

test('storage failures are surfaced without marking a profile completed', async () => {
  shouldFailWrite = true
  await assert.rejects(saveProfile(sampleProfile), ProfileStorageError)
  shouldFailWrite = false
  assert.equal(await hasCompletedProfile(), false)

  shouldFailRead = true
  await assert.rejects(getProfileState(), ProfileStorageError)
})

test('clearing the profile makes the next startup incomplete', async () => {
  await saveProfile(sampleProfile)
  await clearProfile()
  assert.equal(await getProfileState(), null)
  assert.equal(await hasCompletedProfile(), false)
})

test('voice control defaults to enabled and persists explicit choices', async () => {
  assert.equal(await getVoiceControlEnabled(), true)
  await setVoiceControlEnabled(false)
  assert.equal(await getVoiceControlEnabled(), false)
  await setVoiceControlEnabled(true)
  assert.equal(await getVoiceControlEnabled(), true)
})

test('voice control preference changes are observable', async () => {
  const changes = []
  const unsubscribe = subscribeToVoiceControlChanges((enabled) => changes.push(enabled), (error) => {
    throw error
  })
  await setVoiceControlEnabled(false)
  await setVoiceControlEnabled(true)
  unsubscribe()
  assert.deepEqual(changes, [false, true])
})

test('invalid voice control preferences and storage failures are reported', async () => {
  records['accessapply.voiceControlEnabled'] = 'false'
  await assert.rejects(getVoiceControlEnabled(), ProfileStorageError)
  await assert.rejects(setVoiceControlEnabled('false'), ProfileValidationError)
  shouldFailWrite = true
  await assert.rejects(setVoiceControlEnabled(false), ProfileStorageError)
})

test('extension navigation URLs are scoped to the extension', async () => {
  const { getExtensionPageUrl } = await import('../../shared/profile/profileStorage.mjs')
  assert.equal(getExtensionPageUrl('profile-ui/index.html?mode=edit'), 'chrome-extension://test/profile-ui/index.html?mode=edit')
})
